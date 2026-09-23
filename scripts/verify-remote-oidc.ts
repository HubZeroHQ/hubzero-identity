import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const issuer = process.env.VERCEL_REHEARSAL_URL;
const email = process.env.REHEARSAL_TEST_EMAIL;
const password = process.env.REHEARSAL_TEST_PASSWORD;
const clientSecret = process.env.REHEARSAL_CLIENT_SECRET;
if (!issuer || !email || !password || !clientSecret) throw new Error("Missing isolated remote OIDC rehearsal input");
const allowedIssuer = new URL(issuer).origin === "https://hubzero-identity.vercel.app"
  || (process.env.REHEARSAL_CANONICAL_ISSUER === "true" && new URL(issuer).origin === "https://auth.hubzero.in");
if (!allowedIssuer || !email.endsWith("@example.invalid")) throw new Error("Remote OIDC rehearsal is limited to an explicit synthetic issuer and identity");

const callback = "http://127.0.0.1:4100/studio/oidc/callback";
const clientId = "hubzero-studio-rehearsal";
const browser = await chromium.launch({ headless: true });
let last: { code: string; verifier: string; nonce: string; token: string } | undefined;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4100");
  if (url.pathname !== "/studio/oidc/callback" || !pending || url.searchParams.get("state") !== pending.state) return reply(response, 400, "Callback rejected");
  const code = url.searchParams.get("code");
  if (!code) return reply(response, 400, "Code missing");
  const tokens = await exchange(code, pending.verifier);
  if (!tokens.ok) return reply(response, 400, "Token exchange rejected");
  const body = await tokens.json() as { id_token: string };
  const verified = await jwtVerify(body.id_token, createRemoteJWKSet(new URL(`${issuer}/jwks`)), { issuer, audience: clientId });
  if (verified.payload.nonce !== pending.nonce || typeof verified.payload.sub !== "string") return reply(response, 400, "ID token rejected");
  if (Object.prototype.hasOwnProperty.call(verified.payload, "role")) return reply(response, 400, "Unexpected role claim");
  last = { code, verifier: pending.verifier, nonce: pending.nonce, token: body.id_token };
  reply(response, 200, "OIDC complete", "text/html");
});
await new Promise<void>((resolve, reject) => server.listen(4100, "127.0.0.1", () => resolve()).on("error", reject));

let pending: { state: string; nonce: string; verifier: string } | undefined;
let canonicalSessionCookieIsSafe: boolean | undefined;
try {
  const page = await browser.newPage();
  await authorize(page);
  if (!last) throw new Error("Authorization callback did not complete");
  const replay = await exchange(last.code, last.verifier);
  if (replay.status !== 400) throw new Error("Authorization-code replay was accepted");
  const idHeader = decodeProtectedHeader(last.token);
  const claims = await jwtVerify(last.token, createRemoteJWKSet(new URL(`${issuer}/jwks`)), { issuer, audience: clientId });
  const output = { authorizationCodeFlow: true, pkceS256: true, tokenVerified: true, replayRejected: true, subjectFormat: /^hz_[0-9A-HJKMNP-TV-Z]{26}$/.test(String(claims.payload.sub)), activeKid: idHeader.kid, roleClaimAbsent: !("role" in claims.payload), ...(new URL(issuer).origin === "https://auth.hubzero.in" ? { canonicalSessionCookie: canonicalSessionCookieIsSafe === true } : {}) };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  await page.context().close();
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function authorize(page: import("@playwright/test").Page) {
  pending = { state: randomBytes(24).toString("base64url"), nonce: randomBytes(24).toString("base64url"), verifier: randomBytes(48).toString("base64url") };
  const interactionResponses: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "GET" && new URL(response.url()).pathname === "/authorize/interaction") interactionResponses.push(response.status());
  });
  const authorization = new URL(`${issuer}/authorize`);
  authorization.search = new URLSearchParams({ client_id: clientId, response_type: "code", scope: "openid profile email", redirect_uri: callback, state: pending.state, nonce: pending.nonce, code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  await page.goto(authorization.href);
  const issuerUrl = new URL(issuer!);
  const resumeCookieName = issuerUrl.origin === "https://auth.hubzero.in" ? "hz_oidc_resume" : "hz_oidc_resume_dev";
  // oidc-provider scopes this cookie to /authorize/:uid. Asking Playwright for
  // cookies at the issuer root omits a deliberately path-scoped cookie.
  const resumeCookiePresent = (await page.context().cookies()).some((cookie) => cookie.name === resumeCookieName
    && cookie.domain === issuerUrl.hostname
    && cookie.path.startsWith("/authorize/")
    && cookie.httpOnly
    && cookie.sameSite === "Lax"
    && cookie.secure === (issuerUrl.protocol === "https:"));
  if (!resumeCookiePresent) throw new Error("Provider resume cookie was not retained before HubZero Account sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email!);
  await page.getByRole("textbox", { name: "Password" }).fill(password!);
  const signInResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/sign-in");
  await page.getByRole("button", { name: "Continue" }).click();
  const response = await signInResponse;
  await page.waitForURL(/\/authorize\/interaction/, { timeout: 30_000 }).catch(async () => {
    const actionRedirect = response.headers()["x-action-redirect"] ?? response.headers().location ?? "none";
    const status = (await page.locator("#sign-in-status").textContent().catch(() => null))?.trim() ?? "none";
    throw new Error(`Sign-in did not reach the authorization interaction; status=${response.status()}; redirect=${actionRedirect}; path=${new URL(page.url()).pathname}; signInStatus=${JSON.stringify(status)}`);
  });
  if (issuerUrl.origin === "https://auth.hubzero.in") {
    const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-hz_session");
    // A user agent retains a __Host- cookie only with Secure, Path=/, and no
    // Domain attribute. Inspecting the browser cookie adds HttpOnly/SameSite.
    const sessionCookieIsSafe = sessionCookie?.domain === issuerUrl.hostname
      && sessionCookie.path === "/"
      && sessionCookie.secure
      && sessionCookie.httpOnly
      && sessionCookie.sameSite === "Lax";
    canonicalSessionCookieIsSafe = sessionCookieIsSafe;
  }
  await page.waitForTimeout(250);
  const interactionStatus = interactionResponses.at(-1) ?? "unobserved";
  const continueButton = page.getByRole("button", { name: "Continue with HubZero" });
  await continueButton.waitFor({ state: "visible", timeout: 30_000 }).catch(async () => {
    const headings = await page.getByRole("heading").allTextContents();
    const buttons = await page.getByRole("button").allTextContents();
    throw new Error(`Unexpected interaction surface at ${new URL(page.url()).pathname}; status=${interactionStatus}; headings=${JSON.stringify(headings)}; buttons=${JSON.stringify(buttons)}`);
  });
  await continueButton.click();
  await page.getByText("OIDC complete").waitFor();
}

function exchange(code: string, verifier: string) {
  return fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback, code_verifier: verifier }) });
}
function reply(response: import("node:http").ServerResponse, status: number, body: string, type = "text/plain") { response.statusCode = status; response.setHeader("content-type", type); response.end(body); }
