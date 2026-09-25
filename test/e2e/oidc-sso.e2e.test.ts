import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { exportJWK, generateKeyPair, createRemoteJWKSet, importJWK, jwtVerify, SignJWT, decodeProtectedHeader, type JWK } from "jose";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect as vitestExpect, it } from "vitest";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { identityApplicationsCollection, identityMembershipsCollection } from "@/lib/db/collections";
import { CredentialService } from "@/lib/credentials/service";
import { PasswordService } from "@/lib/credentials/password";
import { ProvisioningService } from "@/lib/identity/provisioning";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { generateIdentitySubject } from "@/lib/identity/subject";
import type { IdentitySubject } from "@/domain/identity";
import { startMongoReplicaSet, type MongoTestInstance } from "../integration/mongodb";

const password = "OIDC fixture password 2026";
const databaseName = `hubzero_identity_oidc_e2e_${Date.now()}`;

describe("HubZero Identity OIDC provider and first-party SSO", () => {
  let mongo: MongoTestInstance; let database: Db; let client: MongoClient; let providerServer: ChildProcess; let browser: Browser;
  let issuer: string; let clientA: TestClient; let clientB: TestClient; let subject: IdentitySubject; let retiredSigningKey: JWK;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet(); client = mongo.client; database = client.db(databaseName); await applyIdentityIndexes(database);
    const authPort = await freePort(); const aPort = await freePort(); const bPort = await freePort();
    issuer = `http://127.0.0.1:${authPort}`;
    const [aSecret, bSecret] = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
    clientA = await startTestClient({ host: "127.0.0.2", port: aPort, issuer, clientId: "oidc-test-client-a", clientSecret: aSecret, cookieName: "test_client_a" });
    clientB = await startTestClient({ host: "127.0.0.3", port: bPort, issuer, clientId: "oidc-test-client-b", clientSecret: bSecret, cookieName: "test_client_b" });
    const now = new Date();
    await identityApplicationsCollection(database).insertMany([
      application("oidc-test-a", "oidc-test-client-a", "HubZero OIDC Test Client A", `${clientA.origin}/callback`, "oidc-test-a-secret", now),
      application("oidc-test-b", "oidc-test-client-b", "HubZero OIDC Test Client B", `${clientB.origin}/callback`, "oidc-test-b-secret", now),
    ]);
    const events = new MongoSecurityEventWriter(database); const passwords = PasswordService.create(); const credentials = new CredentialService(database, client, passwords, events);
    const provisioning = new ProvisioningService(database, client, credentials, events); const actor = generateIdentitySubject();
    const provisioned = await provisioning.provision({ name: "OIDC Test User", email: "oidc-user@e2e.invalid", password, accountType: "internal", mustChangePassword: false, applicationIds: ["oidc-test-a" as never, "oidc-test-b" as never], idempotencyKey: "oidc-e2e-provision-key-0001", actorSubject: actor, reason: "isolated OIDC browser fixture" });
    subject = provisioned.subject;
    const retiredPrivateKey = await exportJWK(await generateKeyPair("ES256", { extractable: true }).then((pair) => pair.privateKey));
    retiredSigningKey = { ...retiredPrivateKey, kid: "test-es256-retired", alg: "ES256", use: "sig" };
    const privateKey = await exportJWK(await generateKeyPair("ES256", { extractable: true }).then((pair) => pair.privateKey));
    const signingKey: JWK = { ...privateKey, kid: "test-es256-2026", alg: "ES256", use: "sig" };
    providerServer = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "server.ts"], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
        ...process.env, PORT: String(authPort), APP_ENV: "test", IDENTITY_ISSUER_URL: issuer, MONGODB_URI: mongoUriWithDatabase(mongo.uri, databaseName), MONGODB_DATABASE: databaseName,
        SESSION_HMAC_KEY_BASE64: randomBytes(32).toString("base64"), RATE_LIMIT_HMAC_KEY_BASE64: randomBytes(32).toString("base64"), OIDC_ADAPTER_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
        OIDC_PROVIDER_ENABLED: "true", OIDC_SIGNING_KEYSET_JSON: JSON.stringify({ keys: [retiredSigningKey, signingKey] }), OIDC_SIGNING_ACTIVE_KID: "test-es256-2026", OIDC_CLIENT_SECRETS_JSON: JSON.stringify({ "oidc-test-a-secret": aSecret, "oidc-test-b-secret": bSecret }),
      },
    });
    await waitFor(`${issuer}/health/oidc`, providerServer); browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close(); await clientA?.close(); await clientB?.close();
    if (providerServer && !providerServer.killed) { providerServer.kill(); await once(providerServer, "exit").catch(() => undefined); }
    await database?.dropDatabase(); await mongo?.stop();
  });

  it("publishes a narrow discovery document and public ES256 JWKS", async () => {
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((response) => response.json() as Promise<Record<string, unknown>>);
    vitestExpect(discovery.issuer).toBe(issuer); vitestExpect(discovery.authorization_endpoint).toBe(`${issuer}/authorize`); vitestExpect(discovery.token_endpoint).toBe(`${issuer}/token`);
    vitestExpect(discovery.code_challenge_methods_supported).toEqual(["S256"]); vitestExpect(discovery.scopes_supported).toEqual(vitestExpect.arrayContaining(["openid", "profile", "email"]));
    const jwks = await fetch(`${issuer}/jwks`).then((response) => response.json() as Promise<{ keys: Array<Record<string, unknown>> }>);
    vitestExpect(jwks.keys.map((key) => key.kid)).toEqual(["test-es256-2026", "test-es256-retired"]);
    vitestExpect(jwks.keys.every((key) => !("d" in key))).toBe(true);
    const retiredToken = await new SignJWT({ sub: "hz_01HZXQX7M9C3A7F0H5K2N8P4R6" })
      .setProtectedHeader({ alg: "ES256", kid: "test-es256-retired" })
      .setIssuer(issuer)
      .setAudience("oidc-test-client-a")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(await importJWK(retiredSigningKey, "ES256"));
    await vitestExpect(jwtVerify(retiredToken, createRemoteJWKSet(new URL(`${issuer}/jwks`)), { issuer, audience: "oidc-test-client-a" })).resolves.toBeTruthy();
  });

  it("authenticates Client A, validates tokens, and reuses SSO for Client B", async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(clientA.origin); await page.getByRole("link", { name: "Continue with HubZero" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1.*\/sign-in/); await signIn(page, "oidc-user@e2e.invalid", password);
    await expect(page).toHaveURL(/\/authorize\/interaction/); const completion = page.waitForResponse((response) => response.url().includes("/interaction/") && response.url().endsWith("/continue")); await page.getByRole("button", { name: "Continue with HubZero" }).click();
    const completed = await completion; vitestExpect(completed.status()).toBe(303);
    await expect(page).toHaveURL(clientA.origin); await expect(page.getByText(`Subject: ${subject}`)).toBeVisible();
    await page.goto(clientB.origin); await page.getByRole("link", { name: "Continue with HubZero" }).click();
    await expect(page).toHaveURL(clientB.origin); await expect(page.getByText(`Subject: ${subject}`)).toBeVisible();
    vitestExpect(clientA.lastClaims?.sub).toBe(subject); vitestExpect(clientA.lastClaims?.iss).toBe(issuer); vitestExpect(clientB.lastClaims?.aud).toBe("oidc-test-client-b"); vitestExpect(clientA.lastIdTokenKid).toBe("test-es256-2026");
    await context.close();
  });

  it("rejects stale tab, Back, Refresh, and duplicate continuation without issuing another code", async () => {
    const context = await browser.newContext();
    const primary = await context.newPage();
    await primary.goto(clientA.origin);
    await primary.getByRole("link", { name: "Continue with HubZero" }).click();
    await signIn(primary, "oidc-user@e2e.invalid", password);
    await expect(primary).toHaveURL(/\/authorize\/interaction/);

    const staleTab = await context.newPage();
    const backTab = await context.newPage();
    const refreshTab = await context.newPage();
    for (const tab of [staleTab, backTab, refreshTab]) {
      await tab.goto(`${issuer}/authorize/interaction`);
      await expect(tab.getByRole("button", { name: "Continue with HubZero" })).toBeVisible();
    }
    await backTab.goto("about:blank");

    const before = await oidcStateCounts(database);
    await primary.getByRole("button", { name: "Continue with HubZero" }).click();
    await expect(primary).toHaveURL(clientA.origin);
    await expect(primary.getByText(`Subject: ${subject}`)).toBeVisible();
    const completed = await oidcStateCounts(database);
    vitestExpect(completed.codes).toBe(before.codes + 1);

    const assertStale = async (tab: Page) => {
      const response = tab.waitForResponse((item) => item.url().includes("/interaction/") && item.url().endsWith("/continue"));
      await tab.getByRole("button", { name: "Continue with HubZero" }).click();
      const rejected = await response;
      vitestExpect(rejected.status()).toBe(400);
      vitestExpect(await rejected.text()).toBe("That sign-in request is no longer valid. Return to Studio and start again.");
      vitestExpect(await oidcStateCounts(database)).toEqual(completed);
    };

    await assertStale(staleTab);
    await backTab.goBack();
    await expect(backTab).toHaveURL(/\/authorize\/interaction/);
    await assertStale(backTab);
    await refreshTab.reload();
    await assertStale(refreshTab);

    // Resubmitting the same consumed interaction directly remains single-use.
    const duplicate = await context.request.post(staleTab.url());
    vitestExpect(duplicate.status()).toBe(400);
    vitestExpect(await oidcStateCounts(database)).toEqual(completed);
    const replay = await clientA.replayLastCode();
    vitestExpect(replay.status).toBe(400);
    await context.close();
  });

  it("rejects code replay, invalid redirects, prompt=none after SSO, and membership removal", async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(clientA.origin); await page.getByRole("link", { name: "Continue with HubZero" }).click(); await signIn(page, "oidc-user@e2e.invalid", password); await page.getByRole("button", { name: "Continue with HubZero" }).click(); await expect(page).toHaveURL(clientA.origin);
    await page.goto(`${clientA.origin}/start?prompt=none`); await expect(page).toHaveURL(clientA.origin);
    const replay = await clientA.replayLastCode(); vitestExpect(replay.status).toBe(400); vitestExpect((await replay.json() as { error?: string }).error).toBe("invalid_grant");
    const invalidRedirect = await fetch(`${issuer}/authorize?client_id=oidc-test-client-a&response_type=code&scope=openid&redirect_uri=${encodeURIComponent("http://127.0.0.2:1/callback")}&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`, { redirect: "manual" });
    vitestExpect(invalidRedirect.status).toBe(400);
    const missingPkce = await fetch(`${issuer}/authorize?client_id=oidc-test-client-a&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${clientA.origin}/callback`)}`, { redirect: "manual" });
    vitestExpect(missingPkce.status).toBe(400);
    const plainPkce = await fetch(`${issuer}/authorize?client_id=oidc-test-client-a&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${clientA.origin}/callback`)}&code_challenge=${"a".repeat(43)}&code_challenge_method=plain`, { redirect: "manual" });
    vitestExpect(plainPkce.status).toBe(400);
    const badClient = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from("oidc-test-client-a:wrong-secret").toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code: "not-a-code", redirect_uri: `${clientA.origin}/callback`, code_verifier: "x" }) });
    vitestExpect([400, 401]).toContain(badClient.status);
    await identityMembershipsCollection(database).updateOne({ identitySubject: subject, applicationId: "oidc-test-b" as never }, { $set: { status: "disabled", updatedAt: new Date() } });
    await page.goto(`${clientB.origin}/logout`); await page.goto(clientB.origin); await page.getByRole("link", { name: "Continue with HubZero" }).click();
    await expect(page).toHaveURL(/\/authorize\/interaction/); await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
    await context.close();
  });
});

function application(id: string, clientId: string, displayName: string, redirectUri: string, secretReference: string, now: Date) {
  return { _id: new ObjectId(), id: id as never, slug: id, displayName, description: "Isolated OIDC relying-party fixture", clientId, clientType: "confidential_web" as const, clientSecretReference: secretReference, visibility: "internal" as const, redirectUris: [redirectUri], postLogoutRedirectUris: [], firstParty: true, enabled: true, brand: { homeUrl: redirectUri.slice(0, redirectUri.lastIndexOf("/")) }, createdAt: now, updatedAt: now };
}

interface TestClient { origin: string; close(): Promise<void>; lastClaims: Record<string, unknown> | null; lastIdTokenKid: string | null; replayLastCode(): Promise<Response> }
async function startTestClient(input: { host: string; port: number; issuer: string; clientId: string; clientSecret: string; cookieName: string }): Promise<TestClient> {
  const flows = new Map<string, { state: string; nonce: string; verifier: string }>(); const sessions = new Map<string, Record<string, unknown>>(); let lastCode: string | null = null; let lastVerifier: string | null = null; let lastClaims: Record<string, unknown> | null = null; let lastIdTokenKid: string | null = null;
  const origin = `http://${input.host}:${input.port}`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin); const flowId = cookie(request.headers.cookie, `${input.cookieName}_flow`); const sessionId = cookie(request.headers.cookie, input.cookieName);
    if (url.pathname === "/start") {
      const id = randomBytes(24).toString("base64url"); const state = randomBytes(24).toString("base64url"); const nonce = randomBytes(24).toString("base64url"); const verifier = randomBytes(48).toString("base64url");
      flows.set(id, { state, nonce, verifier }); response.setHeader("Set-Cookie", `${input.cookieName}_flow=${id}; HttpOnly; SameSite=Lax; Path=/`);
      const authorization = new URL(`${input.issuer}/authorize`); authorization.search = new URLSearchParams({ client_id: input.clientId, response_type: "code", scope: "openid profile email", redirect_uri: `${origin}/callback`, state, nonce, code_challenge: sha256url(verifier), code_challenge_method: "S256", ...(url.searchParams.get("prompt") ? { prompt: url.searchParams.get("prompt")! } : {}) }).toString();
      response.statusCode = 303; response.setHeader("Location", authorization.href); return response.end();
    }
    if (url.pathname === "/callback") {
      const flow = flowId ? flows.get(flowId) : undefined; const code = url.searchParams.get("code");
      if (!flow || !code || url.searchParams.get("state") !== flow.state) return reply(response, 400, "Callback rejected");
      const tokenResponse = await exchange(input, code, flow.verifier); if (!tokenResponse.ok) return reply(response, 400, "Token exchange rejected");
      const tokens = await tokenResponse.json() as { id_token: string }; lastIdTokenKid = decodeProtectedHeader(tokens.id_token).kid ?? null; const verified = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(`${input.issuer}/jwks`)), { issuer: input.issuer, audience: input.clientId });
      if (verified.payload.nonce !== flow.nonce) return reply(response, 400, "Nonce rejected");
      const id = randomBytes(24).toString("base64url"); lastCode = code; lastVerifier = flow.verifier; lastClaims = verified.payload as Record<string, unknown>; sessions.set(id, { issuer: input.issuer, sub: verified.payload.sub, name: verified.payload.name, email: verified.payload.email });
      response.setHeader("Set-Cookie", `${input.cookieName}=${id}; HttpOnly; SameSite=Lax; Path=/`); response.statusCode = 303; response.setHeader("Location", "/"); return response.end();
    }
    if (url.pathname === "/logout") { response.setHeader("Set-Cookie", `${input.cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); response.statusCode = 303; response.setHeader("Location", "/"); return response.end(); }
    const session = sessionId ? sessions.get(sessionId) : null;
    reply(response, 200, session ? `<main><h1>Signed in</h1><p>Subject: ${String(session.sub)}</p><p>${String(session.name ?? "")}</p><a href="/logout">Sign out of this test client</a><a href="/start?prompt=login">Authenticate with HubZero again</a></main>` : "<main><h1>Not signed in</h1><a href=\"/start\">Continue with HubZero</a></main>", "text/html");
  });
  await new Promise<void>((resolvePromise, reject) => server.listen(input.port, "0.0.0.0", () => resolvePromise()).on("error", reject));
  return { origin, get lastClaims() { return lastClaims; }, get lastIdTokenKid() { return lastIdTokenKid; }, replayLastCode: () => { if (!lastCode || !lastVerifier) throw new Error("No code was exchanged"); return exchange(input, lastCode, lastVerifier); }, close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())) };
}

function exchange(input: { issuer: string; clientId: string; clientSecret: string; host: string; port: number }, code: string, verifier: string) {
  return fetch(`${input.issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `http://${input.host}:${input.port}/callback`, code_verifier: verifier }) });
}
function cookie(header: string | undefined, name: string) { return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null; }
function sha256url(value: string) { return createHash("sha256").update(value).digest("base64url"); }
async function oidcStateCounts(database: Db) {
  const [codes, grants, sessions] = await Promise.all([
    database.collection("oidc_authorizationcode_artifacts").countDocuments(),
    database.collection("oidc_grant_artifacts").countDocuments(),
    database.collection("identity_sessions").countDocuments(),
  ]);
  return { codes, grants, sessions };
}
function reply(response: import("node:http").ServerResponse, status: number, body: string, type = "text/plain") { response.statusCode = status; response.setHeader("content-type", type); response.end(body); }
async function signIn(page: Page, email: string, secret: string) { await page.getByRole("textbox", { name: "Email" }).fill(email); await page.getByRole("textbox", { name: "Password" }).fill(secret); await page.getByRole("button", { name: "Continue" }).click(); }
function mongoUriWithDatabase(uri: string, name: string): string { return uri.replace("/?", `/${name}?`); }
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>((resolvePromise, reject) => server.listen(0, "127.0.0.1", () => resolvePromise()).on("error", reject)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Could not allocate port"); await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())); return address.port; }
async function waitFor(url: string, child: ChildProcess): Promise<void> { let output = ""; child.stderr?.on("data", (chunk) => { output += String(chunk); }); child.stdout?.on("data", (chunk) => { output += String(chunk); }); for (let attempt = 0; attempt < 80; attempt += 1) { if (child.exitCode !== null) throw new Error(`OIDC server exited before ready: ${output.slice(-800)}`); try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise((resolvePromise) => setTimeout(resolvePromise, 250)); } throw new Error(`OIDC server did not become ready: ${output.slice(-800)}`); }
