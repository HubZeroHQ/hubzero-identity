import { Provider, type AdapterPayload, type ClientMetadata, type Configuration } from "oidc-provider";
import type { JWK } from "jose";
import { identityApplicationsCollection, identityUsersCollection } from "@/lib/db/collections";
import { decodeRequiredBase64Key } from "@/lib/security/crypto";
import { createIdentityRuntime, type IdentityRuntime } from "@/lib/auth/runtime";
import { parseEnvironment, type Environment } from "@/lib/env";
import { createMongoOidcAdapter } from "./mongo-adapter";

export interface OidcProviderRuntime {
  provider: Provider;
  runtime: IdentityRuntime;
}

let singleton: Promise<OidcProviderRuntime> | undefined;

export async function getOidcProvider(): Promise<OidcProviderRuntime> {
  singleton ??= createOidcProvider(parseEnvironment(process.env));
  return singleton;
}

export async function createOidcProvider(environment: Environment): Promise<OidcProviderRuntime> {
  if (!environment.OIDC_PROVIDER_ENABLED) throw new Error("OIDC provider is disabled by configuration");
  const runtime = await createIdentityRuntime(environment);
  const clients = await loadClients(runtime, environment);
  const jwks = parseSigningKeySet(environment.OIDC_SIGNING_KEYSET_JSON!);
  const cookieKey = decodeRequiredBase64Key(environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64");
  const configuration: Configuration = {
    adapter: createMongoOidcAdapter(runtime.database, decodeRequiredBase64Key(environment.OIDC_ADAPTER_HMAC_KEY_BASE64!, "OIDC_ADAPTER_HMAC_KEY_BASE64")),
    clients,
    jwks,
    subjectTypes: ["public"],
    scopes: ["openid", "profile", "email"],
    claims: { openid: ["sub"], profile: ["name"], email: ["email", "email_verified"] },
    clientAuthMethods: ["client_secret_basic"],
    enabledJWA: { idTokenSigningAlgValues: ["ES256"] },
    pkce: { required: () => true },
    allowOmittingSingleRegisteredRedirectUri: false,
    acceptQueryParamAccessTokens: false,
    routes: { authorization: "/authorize", token: "/token", jwks: "/jwks" },
    ttl: { AuthorizationCode: 60, AccessToken: 300, IdToken: 300, Interaction: 10 * 60, Session: 60 * 60, Grant: 60 * 60 },
    cookies: {
      names: environment.APP_ENV === "production"
        ? { session: "__Host-hz_oidc", interaction: "__Host-hz_oidc_interaction", resume: "__Host-hz_oidc_resume" }
        : { session: "hz_oidc_dev", interaction: "hz_oidc_interaction_dev", resume: "hz_oidc_resume_dev" },
      keys: [cookieKey],
      long: { httpOnly: true, secure: environment.APP_ENV !== "development" && environment.APP_ENV !== "test", sameSite: "lax", path: "/" },
      short: { httpOnly: true, secure: environment.APP_ENV !== "development" && environment.APP_ENV !== "test", sameSite: "lax", path: "/" },
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: false },
      registration: { enabled: false },
      registrationManagement: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      deviceFlow: { enabled: false },
      clientCredentials: { enabled: false },
      ciba: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      requestObjects: { enabled: false },
      resourceIndicators: { enabled: false },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (_ctx, subject) => {
      const user = await identityUsersCollection(runtime.database).findOne({ subject: subject as never, status: "active" });
      if (!user) return undefined;
      return {
        accountId: user.subject,
        claims: () => ({ sub: user.subject, name: user.name, email: user.email, email_verified: user.emailVerifiedAt !== null }),
      };
    },
    renderError: (ctx, _out, error) => {
      ctx.status = 400;
      ctx.type = "html";
      void error;
      ctx.body = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title>HubZero request unavailable</title></head><body><main><h1>Request unavailable</h1><p>This sign-in request could not be completed.</p></main></body></html>";
    },
  };
  return { provider: new Provider(environment.IDENTITY_ISSUER_URL, configuration), runtime };
}

async function loadClients(runtime: IdentityRuntime, environment: Environment): Promise<ClientMetadata[]> {
  const secrets = parseClientSecrets(environment.OIDC_CLIENT_SECRETS_JSON!);
  const applications = await identityApplicationsCollection(runtime.database).find({ enabled: true, firstParty: true }).toArray();
  return applications.map((application) => {
    if (application.clientType !== "confidential_web" || !application.clientSecretReference) {
      throw new Error(`Enabled OIDC application ${application.clientId} lacks confidential client configuration`);
    }
    const clientSecret = secrets[application.clientSecretReference];
    if (!clientSecret) throw new Error(`OIDC client secret is unavailable for ${application.clientId}`);
    return {
      client_id: application.clientId,
      client_secret: clientSecret,
      client_name: application.displayName,
      redirect_uris: application.redirectUris,
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic",
      application_type: "web",
      subject_type: "public",
      id_token_signed_response_alg: "ES256",
    };
  });
}

function parseSigningKeySet(value: string): { keys: JWK[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("OIDC_SIGNING_KEYSET_JSON must contain JSON"); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { keys?: unknown }).keys)) throw new Error("OIDC_SIGNING_KEYSET_JSON must be a JWK set");
  const keys = (parsed as { keys: JWK[] }).keys;
  if (!keys.some((key) => key.kty === "EC" && key.crv === "P-256" && key.d && key.kid && key.alg === "ES256")) {
    throw new Error("OIDC signing key set requires an active private ES256 P-256 JWK with kid");
  }
  return { keys };
}

function parseClientSecrets(value: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("OIDC_CLIENT_SECRETS_JSON must contain JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OIDC_CLIENT_SECRETS_JSON must be an object");
  const secrets = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length >= 32));
  if (Object.keys(secrets).length !== Object.keys(parsed).length) throw new Error("OIDC client secrets must be at least 32 characters");
  return secrets;
}

export type OidcInteractionPayload = AdapterPayload & { params?: { client_id?: string; prompt?: string; max_age?: string | number } };
