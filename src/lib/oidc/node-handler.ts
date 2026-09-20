import type { IncomingMessage, ServerResponse } from "node:http";
import type { WithId } from "mongodb";
import type { Environment } from "@/lib/env";
import { getOidcProvider, type OidcProviderRuntime } from "@/lib/oidc/provider";
import { OidcInteractionContinuationService, oidcContinuationCookieName, parseCookie } from "@/lib/oidc/interaction-continuation";
import { decodeRequiredBase64Key } from "@/lib/security/crypto";
import { resolveIdentitySessionToken } from "@/lib/auth/session-resolution";
import { sessionCookieName } from "@/lib/auth/cookies";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection } from "@/lib/db/collections";
import type { ApplicationDocument } from "@/lib/db/documents";

/**
 * Handles only the Node-native OIDC and health surface. It is deliberately
 * independent of a listening HTTP server so Docker's custom server and Vercel
 * Node Functions execute the same protocol bridge.
 */
export interface IdentityNodeRequestOptions {
  /**
   * The Vercel adapter sets configuration-derived forwarding headers after
   * the platform edge has accepted the request. Docker's direct Node entry
   * intentionally leaves this disabled.
   */
  trustedProxyHeaders?: boolean;
}

export async function handleIdentityNodeRequest(request: IncomingMessage, response: ServerResponse, environment: Environment, options: IdentityNodeRequestOptions = {}): Promise<boolean> {
  try {
    if (environment.APP_ENV === "production" && request.headers.host !== new URL(environment.IDENTITY_ISSUER_URL).host) {
      send(response, 421, "Misdirected request");
      return true;
    }
    // Chromium sends Origin: null for native form navigations, including
    // Server Actions. Only normalize it after a canonical-host check.
    if (request.headers.origin === "null" && request.headers.host === new URL(environment.IDENTITY_ISSUER_URL).host) {
      request.headers.origin = new URL(environment.IDENTITY_ISSUER_URL).origin;
    }
    const url = new URL(request.url ?? "/", environment.IDENTITY_ISSUER_URL);
    if (!isIdentityNodeRoute(url.pathname)) return false;
    if (url.pathname === "/health/live") {
      send(response, 204, "");
      return true;
    }
    const oidc = environment.OIDC_PROVIDER_ENABLED ? await getOidcProvider() : null;
    if (url.pathname === "/health/oidc" || url.pathname === "/health/ready") {
      // Metadata routes do not need password modules, but readiness must prove
      // that a normal credential-authentication request can resolve them.
      if (oidc && url.pathname === "/health/ready") await oidc.runtime.passwords.assertRuntimeAvailable();
      send(response, oidc ? 200 : 503, oidc ? "ready" : "OIDC provider disabled");
      return true;
    }
    applyProviderSecurityHeaders(response);
    if (!oidc) {
      send(response, 404, "OIDC provider unavailable");
      return true;
    }
    // Koa's proxy mode is enabled only for Vercel's adapter, which writes the
    // forwarding values from the fixed configured issuer. This avoids trusting
    // caller-supplied forwarding headers in the portable Node entry.
    oidc.provider.proxy = options.trustedProxyHeaders === true;
    const continuationService = new OidcInteractionContinuationService(
      oidc.runtime.database,
      decodeRequiredBase64Key(environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64"),
    );
    if (url.pathname.startsWith("/interaction/") && request.method === "GET") {
      await beginInteraction(request, response, oidc, continuationService, url.pathname.slice("/interaction/".length));
      return true;
    }
    if (url.pathname.startsWith("/interaction/") && url.pathname.endsWith("/continue") && request.method === "POST") {
      await finishInteraction(request, response, oidc, continuationService, url.pathname.slice("/interaction/".length, -"/continue".length));
      return true;
    }
    if (isProviderRoute(url.pathname)) {
      if (url.pathname === "/authorize" && url.searchParams.get("response_type")?.split(" ").includes("code") && (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge"))) {
        send(response, 400, "Invalid authorization request");
        return true;
      }
      await prepareProviderRequest(request, oidc, url);
      await oidc.provider.callback()(request, response);
      return true;
    }
    return false;
  } catch (error) {
    if (!response.headersSent) send(response, 503, runtimeSafeError(environment, error));
    return true;
  }
}

export function isIdentityNodeRoute(pathname: string): boolean {
  return pathname === "/health/live" || pathname === "/health/ready" || pathname === "/health/oidc" || pathname.startsWith("/interaction/") || isProviderRoute(pathname);
}

function isProviderRoute(pathname: string): boolean {
  return pathname === "/authorize" || (pathname.startsWith("/authorize/") && pathname !== "/authorize/interaction") || pathname === "/token" || pathname === "/jwks" || pathname.startsWith("/.well-known/") || pathname.startsWith("/resume/");
}

async function prepareProviderRequest(request: IncomingMessage, oidc: OidcProviderRuntime, url: URL) {
  if (url.pathname !== "/authorize") return;
  const identity = await resolveIdentitySessionToken(oidc.runtime, parseCookie(request.headers.cookie, sessionCookieName(oidc.runtime.environment)));
  const clientId = url.searchParams.get("client_id");
  const application = clientId ? await identityApplicationsCollection(oidc.runtime.database).findOne({ clientId }) : null;
  const membership = identity && application ? await identityMembershipsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" }) : null;
  const credential = identity ? await identityCredentialsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } }) : null;
  const providerCookie = oidc.provider.cookieName("session");
  const providerSessionId = parseCookie(request.headers.cookie, providerCookie);
  const providerSession = providerSessionId ? await oidc.provider.Session.find(providerSessionId).catch(() => undefined) : undefined;
  const mustDropProviderSession = !identity || !application?.enabled || !membership || credential?.mustChangePassword || (providerSession !== undefined && providerSession.accountId !== identity.user.subject) || url.searchParams.get("prompt")?.split(" ").includes("login");
  if (mustDropProviderSession) request.headers.cookie = removeCookie(request.headers.cookie, providerCookie);
}

async function beginInteraction(request: IncomingMessage, response: ServerResponse, oidc: OidcProviderRuntime, continuations: OidcInteractionContinuationService, uid: string) {
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(uid)) return send(response, 400, "Invalid authorization request");
  const details = await oidc.provider.interactionDetails(request, response);
  const clientId = typeof details.params.client_id === "string" ? details.params.client_id : null;
  if (!clientId) return send(response, 400, "Invalid authorization request");
  const identity = await resolveIdentitySessionToken(oidc.runtime, parseCookie(request.headers.cookie, sessionCookieName(oidc.runtime.environment)));
  const application = await identityApplicationsCollection(oidc.runtime.database).findOne({ clientId, enabled: true });
  const membership = identity && application
    ? await identityMembershipsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" })
    : null;
  const credential = identity
    ? await identityCredentialsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } })
    : null;
  const reauthenticationRequired = (typeof details.params.prompt === "string" && details.params.prompt.split(" ").includes("login")) || details.prompt.reasons.includes("max_age");
  const promptNone = typeof details.params.prompt === "string" && details.params.prompt.split(" ").includes("none");
  if (promptNone && !identity) return oidc.provider.interactionFinished(request, response, { error: "login_required", error_description: "HubZero Account authentication is required" }, { mergeWithLastSubmission: false });
  if (promptNone && (!application || !membership || credential?.mustChangePassword === true)) return oidc.provider.interactionFinished(request, response, { error: "interaction_required", error_description: "Additional HubZero Account interaction is required" }, { mergeWithLastSubmission: false });
  if (identity && application && membership && credential?.mustChangePassword !== true && !reauthenticationRequired) {
    return completeInteraction(request, response, oidc, details, identity, application);
  }
  const token = await continuations.create({ interactionUid: uid, clientId, expiresAt: new Date(details.exp * 1000) });
  const secure = oidc.runtime.environment.APP_ENV !== "development" && oidc.runtime.environment.APP_ENV !== "test";
  response.setHeader("Set-Cookie", `${oidcContinuationCookieName(oidc.runtime.environment.APP_ENV)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`);
  response.statusCode = 303;
  response.setHeader("Location", reauthenticationRequired ? "/sign-in?returnTo=%2Fauthorize%2Finteraction&reauth=1" : "/authorize/interaction");
  response.end();
}

async function finishInteraction(request: IncomingMessage, response: ServerResponse, oidc: OidcProviderRuntime, continuations: OidcInteractionContinuationService, uid: string) {
  if (request.headers.origin && request.headers.origin !== "null" && request.headers.origin !== new URL(oidc.runtime.environment.IDENTITY_ISSUER_URL).origin) return send(response, 403, "Invalid request origin");
  const continuation = await continuations.find(parseCookie(request.headers.cookie, oidcContinuationCookieName(oidc.runtime.environment.APP_ENV)), uid);
  if (!continuation) return send(response, 400, "Authorization request expired");
  const identity = await resolveIdentitySessionToken(oidc.runtime, parseCookie(request.headers.cookie, sessionCookieName(oidc.runtime.environment)));
  if (!identity) return redirect(response, "/sign-in?returnTo=%2Fauthorize%2Finteraction");
  const credential = await identityCredentialsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  if (credential?.mustChangePassword) return redirect(response, "/change-password?forced=1&returnTo=%2Fauthorize%2Finteraction");
  const application = await identityApplicationsCollection(oidc.runtime.database).findOne({ clientId: continuation.clientId, enabled: true });
  const membership = application ? await identityMembershipsCollection(oidc.runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" }) : null;
  if (!application || !membership) return redirect(response, "/authorize/interaction?denied=1");
  const details = await oidc.provider.interactionDetails(request, response);
  return completeInteraction(request, response, oidc, details, identity, application);
}

async function completeInteraction(request: IncomingMessage, response: ServerResponse, oidc: OidcProviderRuntime, details: Awaited<ReturnType<OidcProviderRuntime["provider"]["interactionDetails"]>>, identity: NonNullable<Awaited<ReturnType<typeof resolveIdentitySessionToken>>>, application: WithId<ApplicationDocument>) {
  const grant = new oidc.provider.Grant({ accountId: identity.user.subject, clientId: application.clientId });
  grant.addOIDCScope(typeof details.params.scope === "string" ? details.params.scope : "openid");
  const grantId = await grant.save();
  await oidc.runtime.events.append("oidc.authorization_succeeded", { clientId: application.clientId, prompt: "first_party" }, { targetSubject: identity.user.subject, applicationId: application.id });
  await oidc.provider.interactionFinished(request, response, {
    login: { accountId: identity.user.subject, acr: "urn:hubzero:pwd", amr: ["pwd"], ts: Math.floor(identity.authenticatedAt.getTime() / 1000) },
    consent: { grantId },
  }, { mergeWithLastSubmission: false });
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

function send(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
}

function redirect(response: ServerResponse, location: string) {
  response.statusCode = 303;
  response.setHeader("Location", location);
  response.end();
}

function runtimeSafeError(runtimeEnvironment: { APP_ENV: string }, error: unknown) {
  void runtimeEnvironment;
  void error;
  return "HubZero Identity is temporarily unavailable";
}
