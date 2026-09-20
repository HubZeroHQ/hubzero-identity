import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WithId } from "mongodb";
import next from "next";
import { parseEnvironment } from "./src/lib/env";
import { getOidcProvider } from "./src/lib/oidc/provider";
import { OidcInteractionContinuationService, oidcContinuationCookieName, parseCookie } from "./src/lib/oidc/interaction-continuation";
import { decodeRequiredBase64Key } from "./src/lib/security/crypto";
import { resolveIdentitySessionToken } from "./src/lib/auth/session-resolution";
import { sessionCookieName } from "./src/lib/auth/cookies";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection } from "./src/lib/db/collections";
import type { ApplicationDocument } from "./src/lib/db/documents";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const environment = parseEnvironment(process.env);
const development = environment.APP_ENV === "development";
const application = next({ dev: development, hostname: "127.0.0.1", port });

async function main() {
  await application.prepare();
  const oidc = environment.OIDC_PROVIDER_ENABLED ? await getOidcProvider() : null;
  const providerHandler = oidc?.provider.callback();
  const continuationService = oidc ? new OidcInteractionContinuationService(oidc.runtime.database, decodeRequiredBase64Key(environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64")) : null;
  const server = createServer(async (request, response) => {
    try {
      if (environment.APP_ENV === "production" && request.headers.host !== new URL(environment.IDENTITY_ISSUER_URL).host) {
        return send(response, 421, "Misdirected request");
      }
      // Chromium sends Origin: null for native form navigations, including
      // Server Actions. Only normalize it after the request host has matched
      // the configured Identity origin; arbitrary forwarded origins remain
      // rejected by Next and by our action-level origin checks.
      if (request.headers.origin === "null" && request.headers.host === new URL(environment.IDENTITY_ISSUER_URL).host) {
        request.headers.origin = new URL(environment.IDENTITY_ISSUER_URL).origin;
      }
      const url = new URL(request.url ?? "/", environment.IDENTITY_ISSUER_URL);
      if (url.pathname === "/health/oidc" || isProviderRoute(url.pathname) || url.pathname.startsWith("/interaction/")) {
        applyProviderSecurityHeaders(response);
      }
      if (url.pathname === "/health/live") return send(response, 204, "");
      if (url.pathname === "/health/oidc" || url.pathname === "/health/ready") return send(response, oidc ? 200 : 503, oidc ? "ready" : "OIDC provider disabled");
      if (oidc && continuationService && url.pathname.startsWith("/interaction/") && request.method === "GET") {
        return beginInteraction(request, response, oidc.provider, oidc.runtime, continuationService, url.pathname.slice("/interaction/".length));
      }
      if (oidc && continuationService && url.pathname.startsWith("/interaction/") && url.pathname.endsWith("/continue") && request.method === "POST") {
        return finishInteraction(request, response, oidc.provider, oidc.runtime, continuationService, url.pathname.slice("/interaction/".length, -"/continue".length));
      }
      if (isProviderRoute(url.pathname)) {
        if (!oidc || !providerHandler) return send(response, 404, "OIDC provider unavailable");
        if (url.pathname === "/authorize" && url.searchParams.get("response_type")?.split(" ").includes("code") && (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge"))) {
          return send(response, 400, "Invalid authorization request");
        }
        await prepareProviderRequest(request, oidc.provider, oidc.runtime, url);
        return providerHandler(request, response);
      }
      return application.getRequestHandler()(request, response);
    } catch (error) {
      if (!response.headersSent) send(response, 503, runtimeSafeError(environment, error));
    }
  });
  server.listen(port, "0.0.0.0", () => console.info(`HubZero Identity listening on port ${port}`));
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    server.close(async () => {
      await oidc?.runtime.client.close().catch(() => undefined);
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}

async function prepareProviderRequest(request: IncomingMessage, provider: Awaited<ReturnType<typeof getOidcProvider>>["provider"], runtime: Awaited<ReturnType<typeof getOidcProvider>>["runtime"], url: URL) {
  if (url.pathname !== "/authorize") return;
  const identity = await resolveIdentitySessionToken(runtime, parseCookie(request.headers.cookie, sessionCookieName(runtime.environment)));
  const clientId = url.searchParams.get("client_id");
  const application = clientId ? await identityApplicationsCollection(runtime.database).findOne({ clientId }) : null;
  const membership = identity && application ? await identityMembershipsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" }) : null;
  const credential = identity ? await identityCredentialsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } }) : null;
  const providerCookie = provider.cookieName("session");
  const providerSessionId = parseCookie(request.headers.cookie, providerCookie);
  const providerSession = providerSessionId ? await provider.Session.find(providerSessionId).catch(() => undefined) : undefined;
  const mustDropProviderSession = !identity || !application?.enabled || !membership || credential?.mustChangePassword || (providerSession !== undefined && providerSession.accountId !== identity.user.subject) || url.searchParams.get("prompt")?.split(" ").includes("login");
  if (mustDropProviderSession) request.headers.cookie = removeCookie(request.headers.cookie, providerCookie);
}

async function beginInteraction(request: IncomingMessage, response: ServerResponse, provider: Awaited<ReturnType<typeof getOidcProvider>>["provider"], runtime: Awaited<ReturnType<typeof getOidcProvider>>["runtime"], continuations: OidcInteractionContinuationService, uid: string) {
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(uid)) return send(response, 400, "Invalid authorization request");
  const details = await provider.interactionDetails(request, response);
  const clientId = typeof details.params.client_id === "string" ? details.params.client_id : null;
  if (!clientId) return send(response, 400, "Invalid authorization request");
  const identity = await resolveIdentitySessionToken(runtime, parseCookie(request.headers.cookie, sessionCookieName(runtime.environment)));
  const application = await identityApplicationsCollection(runtime.database).findOne({ clientId, enabled: true });
  const membership = identity && application
    ? await identityMembershipsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" })
    : null;
  const credential = identity
    ? await identityCredentialsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } })
    : null;
  const reauthenticationRequired = (typeof details.params.prompt === "string" && details.params.prompt.split(" ").includes("login")) || details.prompt.reasons.includes("max_age");
  const promptNone = typeof details.params.prompt === "string" && details.params.prompt.split(" ").includes("none");
  if (promptNone && !identity) {
    return provider.interactionFinished(request, response, { error: "login_required", error_description: "HubZero Account authentication is required" }, { mergeWithLastSubmission: false });
  }
  if (promptNone && (!application || !membership || credential?.mustChangePassword === true)) {
    return provider.interactionFinished(request, response, { error: "interaction_required", error_description: "Additional HubZero Account interaction is required" }, { mergeWithLastSubmission: false });
  }
  // Trusted first-party clients do not need a consent screen. If the existing
  // HubZero Account session is eligible, complete the interaction immediately
  // so a second client receives true SSO rather than another Continue screen.
  if (identity && application && membership && credential?.mustChangePassword !== true && !reauthenticationRequired) {
    return completeInteraction(request, response, provider, runtime, details, identity, application);
  }
  const token = await continuations.create({ interactionUid: uid, clientId, expiresAt: new Date(details.exp * 1000) });
  const secure = runtime.environment.APP_ENV !== "development" && runtime.environment.APP_ENV !== "test";
  response.setHeader("Set-Cookie", `${oidcContinuationCookieName(runtime.environment.APP_ENV)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`);
  response.statusCode = 303;
  response.setHeader("Location", reauthenticationRequired ? "/sign-in?returnTo=%2Fauthorize%2Finteraction&reauth=1" : "/authorize/interaction");
  response.end();
}

async function finishInteraction(request: IncomingMessage, response: ServerResponse, provider: Awaited<ReturnType<typeof getOidcProvider>>["provider"], runtime: Awaited<ReturnType<typeof getOidcProvider>>["runtime"], continuations: OidcInteractionContinuationService, uid: string) {
  // Some browser form navigations omit Origin. In that narrow case the provider's
  // signed interaction cookie and our 256-bit SameSite continuation cookie remain
  // mandatory; a supplied cross-origin value is always rejected.
  if (request.headers.origin && request.headers.origin !== "null" && request.headers.origin !== new URL(runtime.environment.IDENTITY_ISSUER_URL).origin) return send(response, 403, "Invalid request origin");
  const continuation = await continuations.find(parseCookie(request.headers.cookie, oidcContinuationCookieName(runtime.environment.APP_ENV)), uid);
  if (!continuation) return send(response, 400, "Authorization request expired");
  const identity = await resolveIdentitySessionToken(runtime, parseCookie(request.headers.cookie, sessionCookieName(runtime.environment)));
  if (!identity) return redirect(response, "/sign-in?returnTo=%2Fauthorize%2Finteraction");
  const credential = await identityCredentialsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  if (credential?.mustChangePassword) return redirect(response, "/change-password?forced=1&returnTo=%2Fauthorize%2Finteraction");
  const application = await identityApplicationsCollection(runtime.database).findOne({ clientId: continuation.clientId, enabled: true });
  const membership = application ? await identityMembershipsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" }) : null;
  if (!application || !membership) return redirect(response, "/authorize/interaction?denied=1");
  const details = await provider.interactionDetails(request, response);
  return completeInteraction(request, response, provider, runtime, details, identity, application);
}

async function completeInteraction(request: IncomingMessage, response: ServerResponse, provider: Awaited<ReturnType<typeof getOidcProvider>>["provider"], runtime: Awaited<ReturnType<typeof getOidcProvider>>["runtime"], details: Awaited<ReturnType<Awaited<ReturnType<typeof getOidcProvider>>["provider"]["interactionDetails"]>>, identity: NonNullable<Awaited<ReturnType<typeof resolveIdentitySessionToken>>>, application: WithId<ApplicationDocument>) {
  const grant = new provider.Grant({ accountId: identity.user.subject, clientId: application.clientId });
  grant.addOIDCScope(typeof details.params.scope === "string" ? details.params.scope : "openid");
  const grantId = await grant.save();
  await runtime.events.append("oidc.authorization_succeeded", { clientId: application.clientId, prompt: "first_party" }, { targetSubject: identity.user.subject, applicationId: application.id });
  await provider.interactionFinished(request, response, {
    login: { accountId: identity.user.subject, acr: "urn:hubzero:pwd", amr: ["pwd"], ts: Math.floor(identity.authenticatedAt.getTime() / 1000) },
    consent: { grantId },
  }, { mergeWithLastSubmission: false });
}

function isProviderRoute(pathname: string): boolean {
  return pathname === "/authorize" || (pathname.startsWith("/authorize/") && pathname !== "/authorize/interaction") || pathname === "/token" || pathname === "/jwks" || pathname.startsWith("/.well-known/") || pathname.startsWith("/resume/");
}
function applyProviderSecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
function removeCookie(header: string | undefined, name: string): string {
  return (header ?? "").split(";").filter((item) => !item.trim().startsWith(`${name}=`) && !item.trim().startsWith(`${name}.sig=`)).join(";");
}
function send(response: ServerResponse, status: number, message: string) { response.statusCode = status; response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end(message); }
function redirect(response: ServerResponse, location: string) { response.statusCode = 303; response.setHeader("Location", location); response.end(); }
function runtimeSafeError(runtimeEnvironment: { APP_ENV: string }, error: unknown) {
  void runtimeEnvironment; void error;
  return "HubZero Identity is temporarily unavailable";
}

main().catch((error) => { console.error("HubZero Identity could not start", error instanceof Error ? error.message : "unknown error"); process.exit(1); });
