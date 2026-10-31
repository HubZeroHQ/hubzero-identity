import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const canonicalHost = "auth.hubzero.in";
const deploymentHost = "hubzero-identity-e2e-team.vercel.app";

interface ProbeResponse { status: number; headers: Record<string, string | string[] | undefined> }

/** Sets `Host` directly, which `fetch` forbids, against a real `next start`. */
function probe(port: number, host: string, path: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<ProbeResponse> {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host, ...options.headers } }, (response) => {
      response.resume();
      response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, headers: response.headers }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => server.listen(0, "127.0.0.1", () => done()).on("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate proxy-test port");
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

function start(port: number, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IDENTITY_ISSUER_URL: `https://${canonicalHost}`,
      // Nothing listens here: the rejected and unauthenticated paths under test must not need a database.
      MONGODB_URI: "mongodb://127.0.0.1:9/hubzero_identity_proxy_e2e?serverSelectionTimeoutMS=250",
      SESSION_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
      RATE_LIMIT_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
      ...env,
    },
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
}

async function waitForListening(port: number, child: ChildProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Next.js proxy-test server exited before becoming ready");
    try { await probe(port, "startup.invalid", "/sign-in"); return; } catch { /* wait */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Next.js proxy-test server did not become ready");
}

async function stop(child: ChildProcess | undefined) {
  if (child && child.exitCode === null) { child.kill(); await once(child, "exit").catch(() => undefined); }
}

describe("Proxy host boundary", () => {
  let productionServer: ChildProcess; let previewServer: ChildProcess;
  let productionPort: number; let previewPort: number;

  beforeAll(async () => {
    [productionPort, previewPort] = [await freePort(), await freePort()];
    productionServer = start(productionPort, { APP_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: deploymentHost });
    previewServer = start(previewPort, { APP_ENV: "preview", VERCEL_ENV: "preview", VERCEL_URL: deploymentHost });
    await Promise.all([waitForListening(productionPort, productionServer), waitForListening(previewPort, previewServer)]);
  });

  afterAll(async () => { await Promise.all([stop(productionServer), stop(previewServer)]); });

  it("answers 421 for unexpected production hosts on every kind of route", async () => {
    for (const host of ["hubzero-identity.vercel.app", deploymentHost, "evil.example"]) {
      for (const path of ["/sign-in", "/", "/token", "/jwks", "/.well-known/openid-configuration", "/api/oidc/token", "/internal/session/refresh", "/favicon.ico", "/brand/hubzero-logo-black.svg"]) {
        const response = await probe(productionPort, host, path);
        expect([host, path, response.status]).toEqual([host, path, 421]);
        expect(response.headers.location).toBeUndefined();
      }
    }
  });

  it("rejects Server Action and POST requests before they reach the application", async () => {
    const response = await probe(productionPort, "evil.example", "/sign-in", { method: "POST", headers: { "next-action": "0".repeat(40), origin: "https://evil.example" } });
    expect(response.status).toBe(421);
  });

  it("cannot be skipped with prefetch or forwarded-host headers", async () => {
    const bypassAttempts: Record<string, string>[] = [{ purpose: "prefetch" }, { "next-router-prefetch": "1" }, { "x-forwarded-host": canonicalHost }];
    for (const headers of bypassAttempts) {
      expect((await probe(productionPort, "evil.example", "/sign-in", { headers })).status).toBe(421);
    }
  });

  it("does not trust a forged forwarded host on the canonical host", async () => {
    const response = await probe(productionPort, canonicalHost, "/sign-in", { headers: { "x-forwarded-host": "evil.example" } });
    expect(response.status).not.toBe(421);
    expect(String(response.headers.location ?? "")).not.toContain("evil.example");
  });

  it("applies the enforced policy to the canonical host in production", async () => {
    const response = await probe(productionPort, canonicalHost, "/sign-in");
    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("upgrade-insecure-requests");
    expect(response.headers["content-security-policy"]).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("accepts only the exact deployment hostname on a preview", async () => {
    expect((await probe(previewPort, deploymentHost, "/sign-in")).status).toBe(200);
    for (const host of [canonicalHost, "hubzero-identity.vercel.app", "other-deployment.vercel.app"]) expect((await probe(previewPort, host, "/sign-in")).status).toBe(421);
  });

  it("enforces the same policy on a preview", async () => {
    const response = await probe(previewPort, deploymentHost, "/sign-in");
    expect(response.headers["content-security-policy"]).toContain("'nonce-");
    expect(response.headers["content-security-policy-report-only"]).toBeUndefined();
  });
});
