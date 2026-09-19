import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, it } from "vitest";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { identityApplicationsCollection, identitySessionsCollection, identityUsersCollection } from "@/lib/db/collections";
import { CredentialService } from "@/lib/credentials/service";
import { PasswordService } from "@/lib/credentials/password";
import { ProvisioningService } from "@/lib/identity/provisioning";
import { AccountSecurityService } from "@/lib/identity/account-security";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { generateIdentitySubject } from "@/lib/identity/subject";
import type { IdentitySubject } from "@/domain/identity";
import { startMongoReplicaSet, type MongoTestInstance } from "../integration/mongodb";

const originalPassword = "A durable test password 2026";
const changedPassword = "A replacement test password 2026";
const databaseName = `hubzero_identity_e2e_${Date.now()}`;
const regularEmail = "account@e2e.invalid";
const forcedEmail = "forced@e2e.invalid";
const sessionEmail = "sessions@e2e.invalid";
const suspendedEmail = "suspended@e2e.invalid";

describe("HubZero Account browser lifecycle", () => {
  let mongo: MongoTestInstance;
  let client: MongoClient;
  let database: Db;
  let browser: Browser;
  let server: ChildProcess;
  let baseUrl: string;
  let actorSubject: IdentitySubject;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet();
    client = mongo.client;
    database = client.db(databaseName);
    await applyIdentityIndexes(database);
    actorSubject = generateIdentitySubject();
    const now = new Date();
    await identityApplicationsCollection(database).insertMany([
      { _id: new ObjectId(), id: "studio" as never, slug: "studio", displayName: "HubZero Studio", description: "Development Studio", clientId: "studio-e2e", clientType: "confidential_web", visibility: "internal", redirectUris: ["http://localhost/callback"], postLogoutRedirectUris: ["http://localhost"], firstParty: true, enabled: true, brand: { homeUrl: "hubzero.in", mark: "S" }, createdAt: now, updatedAt: now },
      { _id: new ObjectId(), id: "fitness" as never, slug: "fitness", displayName: "HubZero Fitness", description: "Development Fitness", clientId: "fitness-e2e", clientType: "confidential_web", visibility: "private", redirectUris: ["http://localhost/callback"], postLogoutRedirectUris: ["http://localhost"], firstParty: true, enabled: true, brand: { homeUrl: "fitness.hubzero.in", mark: "F" }, createdAt: now, updatedAt: now },
    ]);
    const events = new MongoSecurityEventWriter(database);
    const passwords = PasswordService.create();
    const credentials = new CredentialService(database, client, passwords, events);
    const provisioning = new ProvisioningService(database, client, credentials, events);
    for (const [name, email, mustChangePassword] of [["Account Test", regularEmail, false], ["Forced Test", forcedEmail, true], ["Sessions Test", sessionEmail, false], ["Suspended Test", suspendedEmail, false]] as const) {
      await provisioning.provision({ name, email, password: originalPassword, accountType: "internal", mustChangePassword, applicationIds: ["studio" as never, "fitness" as never], idempotencyKey: `e2e-${email}-key-0001`, actorSubject, reason: "isolated browser fixture" });
    }
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "test",
        IDENTITY_ISSUER_URL: baseUrl,
        MONGODB_URI: mongoUriWithDatabase(mongo.uri, databaseName),
        MONGODB_DATABASE: databaseName,
        SESSION_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
        RATE_LIMIT_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    await waitForServer(baseUrl, server);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    if (server && !server.killed) {
      server.kill();
      await once(server, "exit").catch(() => undefined);
    }
    await database?.dropDatabase();
    await mongo?.stop();
  });

  it("guards account routes, resists enumeration, rejects external returns, and signs in", async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(`${baseUrl}/profile`);
    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fprofile/);
    await signIn(page, "unknown@e2e.invalid", "not the right password");
    await expect(page.locator("body")).toContainText("Email or password is incorrect.");
    await page.goto(`${baseUrl}/sign-in?returnTo=https://example.invalid/elsewhere`);
    await signIn(page, regularEmail, originalPassword);
    await expect(page).toHaveURL(`${baseUrl}/`);
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    await expect(page.getByText("HubZero Studio")).toBeVisible();
    expect(consoleErrors).toEqual([]);
    await context.close();
  });

  it("rate limits repeated unknown-account attempts without changing the public credential error", async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`${baseUrl}/sign-in`);
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await signIn(page, "throttled@e2e.invalid", `bad password ${attempt}`);
    }
    await expect(page.locator("#sign-in-status")).toContainText("Too many attempts");
    await context.close();
  });

  it("enforces forced password change and replaces the session after a voluntary password change", async () => {
    const forced = await browser.newContext(); const forcedPage = await forced.newPage();
    await forcedPage.goto(`${baseUrl}/sign-in`); await signIn(forcedPage, forcedEmail, originalPassword);
    await expect(forcedPage).toHaveURL(/\/change-password\?forced=1/);
    await forcedPage.goto(`${baseUrl}/applications`);
    await expect(forcedPage).toHaveURL(/\/change-password\?forced=1/);
    await changePassword(forcedPage, originalPassword, changedPassword);
    await expect(forcedPage).toHaveURL(/\/\?notice=password-changed/);
    await forced.close();

    const first = await browser.newContext(); const firstPage = await first.newPage();
    await firstPage.goto(`${baseUrl}/sign-in`); await signIn(firstPage, regularEmail, originalPassword);
    const second = await browser.newContext(); const secondPage = await second.newPage();
    await secondPage.goto(`${baseUrl}/sign-in`); await signIn(secondPage, regularEmail, originalPassword);
    await firstPage.goto(`${baseUrl}/security`);
    await changePassword(firstPage, "wrong current password", changedPassword);
    await expect(firstPage.locator("#password-status")).toHaveText("Your current password is incorrect.");
    await changePassword(firstPage, originalPassword, changedPassword);
    await expect(firstPage).toHaveURL(/\/\?notice=password-changed/);
    await secondPage.goto(`${baseUrl}/`);
    await expect(secondPage).toHaveURL(/\/sign-in/);
    await first.close(); await second.close();
  });

  it("lists sessions, revokes another session, keeps the current browser on sign-out-other-sessions, and rotates safely", async () => {
    const first = await browser.newContext(); const firstPage = await first.newPage();
    await firstPage.goto(`${baseUrl}/sign-in`); await signIn(firstPage, sessionEmail, originalPassword);
    const second = await browser.newContext(); const secondPage = await second.newPage();
    await secondPage.goto(`${baseUrl}/sign-in`); await signIn(secondPage, sessionEmail, originalPassword);
    await firstPage.goto(`${baseUrl}/sessions`);
    await expect(firstPage.locator("article")).toHaveCount(2);
    const cards = firstPage.locator("article");
    for (let index = 0; index < await cards.count(); index += 1) {
      if (!(await cards.nth(index).textContent())?.includes("This browser")) { await cards.nth(index).getByRole("button", { name: "Sign out" }).click(); break; }
    }
    await expect(firstPage).toHaveURL(/session-revoked/);
    await secondPage.goto(`${baseUrl}/`); await expect(secondPage).toHaveURL(/\/sign-in/);
    const third = await browser.newContext(); const thirdPage = await third.newPage();
    await thirdPage.goto(`${baseUrl}/sign-in`); await signIn(thirdPage, sessionEmail, originalPassword);
    await firstPage.goto(`${baseUrl}/sessions`);
    const before = await first.cookies();
    const token = before.find((cookie) => cookie.name === "hz_session_dev")?.value;
    const sessionId = token?.split(".")[0];
    await identitySessionsCollection(database).updateOne({ id: sessionId }, { $set: { rotatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1) } });
    await firstPage.reload();
    await firstPage.waitForTimeout(400);
    const after = await first.cookies();
    expect(after.find((cookie) => cookie.name === "hz_session_dev")?.value).not.toBe(token);
    await firstPage.getByRole("button", { name: "Sign out other sessions" }).click();
    await expect(firstPage).toHaveURL(/other-sessions-signed-out/);
    await thirdPage.goto(`${baseUrl}/`); await expect(thirdPage).toHaveURL(/\/sign-in/);
    await first.close(); await second.close(); await third.close();
  });

  it("denies a suspended account after proof and invalidates an active session", async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`${baseUrl}/sign-in`); await signIn(page, suspendedEmail, originalPassword);
    const account = await identityUsersCollection(database).findOne({ normalizedEmail: suspendedEmail });
    if (!account) throw new Error("Suspended fixture was not provisioned");
    await new AccountSecurityService(database, client, new MongoSecurityEventWriter(database)).suspend(account.subject, actorSubject, "e2e suspension");
    await page.goto(`${baseUrl}/`); await expect(page).toHaveURL(/\/sign-in/);
    await signIn(page, suspendedEmail, originalPassword);
    await expect(page.locator("#sign-in-status")).toHaveText("This HubZero Account is currently unavailable.");
    await context.close();
  });

  it("keeps the sign-in surface usable without horizontal overflow at required widths", async () => {
    for (const width of [1280, 768, 430, 390, 360, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/sign-in`);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await context.close();
    }
  });
});

async function signIn(page: Page, email: string, password: string) {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(250);
}

async function changePassword(page: Page, current: string, next: string) {
  await page.getByRole("textbox", { name: "Current password" }).fill(current);
  await page.getByRole("textbox", { name: "New password", exact: true }).fill(next);
  await page.getByRole("textbox", { name: "Confirm new password" }).fill(next);
  await page.getByRole("button", { name: /Change password|Set new password/ }).click();
}

function mongoUriWithDatabase(uri: string, name: string): string { return uri.replace("/?", `/${name}?`); }

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", () => resolve()).on("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate browser-test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Next.js browser-test server exited before becoming ready");
    try { if ((await fetch(`${url}/sign-in`)).ok) return; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next.js browser-test server did not become ready");
}
