import { PRODUCTION_IDENTITY_ISSUER, STAGING_IDENTITY_DATABASE } from "@/lib/env";

/** Identifiers owned by the production Studio client; never usable in staging. */
export const PRODUCTION_STUDIO_CLIENT_ID = "hubzero-studio";
export const PRODUCTION_STUDIO_SECRET_REFERENCE = "studio-production";
export const PRODUCTION_STUDIO_CALLBACK = "https://hubzero.in/studio/oidc/callback";

const PRODUCTION_STUDIO_HOSTS = new Set(["hubzero.in", "www.hubzero.in"]);
const STAGING_CLIENT_ID = /^hubzero-studio-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAGING_SECRET_REFERENCE = /^studio-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface StagingStudioClientInput {
  issuer: string;
  database: string;
  clientId: string;
  callback: string;
  secretReference: string;
}

export interface StagingStudioClientPlan {
  applicationId: string;
  clientId: string;
  callback: string;
  secretReference: string;
}

/**
 * Validates a Studio client registration for the isolated staging issuer and
 * returns the application identity to register, or throws. Every rule fails
 * closed: production issuer, database, client ID, secret reference, callback
 * host, and any non-HTTPS or non-exact callback are refused.
 */
export function planStagingStudioClient(input: StagingStudioClientInput): StagingStudioClientPlan {
  const issuer = parseUrl(input.issuer, "issuer");
  if (issuer.protocol !== "https:") throw new Error("The staging issuer must use HTTPS");
  if (issuer.hostname.toLowerCase() === new URL(PRODUCTION_IDENTITY_ISSUER).hostname) {
    throw new Error("Refusing the production issuer host");
  }
  if (input.database !== STAGING_IDENTITY_DATABASE) {
    throw new Error(`Refusing any database other than ${STAGING_IDENTITY_DATABASE}`);
  }
  if (input.clientId === PRODUCTION_STUDIO_CLIENT_ID || !STAGING_CLIENT_ID.test(input.clientId)) {
    throw new Error("The client ID must be a dedicated hubzero-studio-<name> identifier, never hubzero-studio");
  }
  if (input.secretReference === PRODUCTION_STUDIO_SECRET_REFERENCE || !STAGING_SECRET_REFERENCE.test(input.secretReference)) {
    throw new Error("The secret reference must be a dedicated studio-<name> reference, never studio-production");
  }
  const callback = parseUrl(input.callback, "callback");
  if (callback.protocol !== "https:") throw new Error("The callback must use HTTPS");
  if (PRODUCTION_STUDIO_HOSTS.has(callback.hostname.toLowerCase()) || input.callback === PRODUCTION_STUDIO_CALLBACK) {
    throw new Error("Refusing the production Studio callback host");
  }
  if (callback.pathname !== "/studio/oidc/callback" || callback.search || callback.hash || callback.username || callback.password) {
    throw new Error("The callback must be exactly https://<host>/studio/oidc/callback");
  }
  if (callback.href !== input.callback) throw new Error("The callback must be given in canonical form");
  return {
    applicationId: `studio-${input.clientId.slice("hubzero-studio-".length)}`,
    clientId: input.clientId,
    callback: input.callback,
    secretReference: input.secretReference,
  };
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`The ${name} is not a valid URL`);
  }
}

export interface ProductionStudioClientAssessment {
  /** Exactly one enabled application may complete the production Studio callback. */
  singleEnabledApplicationForCallback: boolean;
  /** That application's client ID is the one Studio's contract pins. */
  clientIdIsHubzeroStudio: boolean;
  /** It is the confidential client with the production secret reference and no other redirect. */
  registrationMatchesContract: boolean;
}

/**
 * PRE-10 evidence without disclosing any configuration value: Identity accepts
 * an authorization request only from a registered client whose redirect URIs
 * contain the exact callback, so if exactly one enabled application lists the
 * production Studio callback and its client ID is `hubzero-studio`, a working
 * production Studio sign-in can only be using `hubzero-studio`.
 */
export function assessProductionStudioClient(
  applications: ReadonlyArray<{ clientId: string; enabled: boolean; redirectUris: readonly string[]; clientType?: string; clientSecretReference?: string | null }>,
): ProductionStudioClientAssessment {
  const forCallback = applications.filter((application) => application.enabled && application.redirectUris.includes(PRODUCTION_STUDIO_CALLBACK));
  const only = forCallback.length === 1 ? forCallback[0] : undefined;
  return {
    singleEnabledApplicationForCallback: forCallback.length === 1,
    clientIdIsHubzeroStudio: only?.clientId === PRODUCTION_STUDIO_CLIENT_ID,
    registrationMatchesContract: Boolean(
      only && only.clientType === "confidential_web" && only.clientSecretReference === PRODUCTION_STUDIO_SECRET_REFERENCE
        && only.redirectUris.length === 1,
    ),
  };
}
