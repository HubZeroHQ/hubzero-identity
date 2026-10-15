import { z } from "zod";

export const PRODUCTION_IDENTITY_ISSUER = "https://auth.hubzero.in";
/** The only database an `APP_ENV=staging` (isolated OIDC test) runtime may use. */
export const STAGING_IDENTITY_DATABASE = "hubzero_identity_staging";

export type AppEnvironment = "development" | "test" | "preview" | "staging" | "production";

/**
 * Production and staging get production-grade behaviour everywhere: HTTPS,
 * required HMAC keys, `__Host-` cookies, Secure cookies and canonical-host
 * enforcement. Staging differs only in its issuer and database.
 */
export function isProductionGrade(appEnvironment: string | undefined): boolean {
  return appEnvironment === "production" || appEnvironment === "staging";
}

function sameIssuerHost(issuer: string, other: string): boolean {
  try {
    return new URL(issuer).hostname.toLowerCase() === new URL(other).hostname.toLowerCase();
  } catch {
    return false;
  }
}

const optionalSecret = z.string().min(1).optional();
const booleanFlag = z.enum(["true", "false"]).optional().transform((value) => value === "true");

export const environmentSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "preview", "staging", "production"]),
    IDENTITY_ISSUER_URL: z.string().url(),
    MONGODB_URI: z.string().min(1),
    MONGODB_DATABASE: z.string().min(1).optional(),
    SESSION_HMAC_KEY_BASE64: optionalSecret,
    RATE_LIMIT_HMAC_KEY_BASE64: optionalSecret,
    TRUSTED_PROXIES: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    EMAIL_PROVIDER_API_KEY: optionalSecret,
    OIDC_SIGNING_KEYSET_JSON: optionalSecret,
    /** Non-secret `kid` selecting the only key permitted to sign new ID tokens. */
    OIDC_SIGNING_ACTIVE_KID: z.string().min(1).max(256).optional(),
    OIDC_PROVIDER_ENABLED: booleanFlag,
    OIDC_ADAPTER_HMAC_KEY_BASE64: optionalSecret,
    /** JSON object mapping an Identity-owned secret reference to a client secret. */
    OIDC_CLIENT_SECRETS_JSON: optionalSecret,
  })
  .transform((environment, context) => {
    let uriDatabase: string | null = null;
    try {
      const parsed = new URL(environment.MONGODB_URI);
      uriDatabase = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    } catch {
      context.addIssue({ code: "custom", path: ["MONGODB_URI"], message: "MONGODB_URI must include an explicit database name" });
      return z.NEVER;
    }
    if (!uriDatabase) {
      context.addIssue({ code: "custom", path: ["MONGODB_URI"], message: "MONGODB_URI must include an explicit database name" });
      return z.NEVER;
    }
    if (environment.MONGODB_DATABASE && environment.MONGODB_DATABASE !== uriDatabase) {
      context.addIssue({ code: "custom", path: ["MONGODB_DATABASE"], message: "MONGODB_DATABASE must match the database named by MONGODB_URI" });
      return z.NEVER;
    }
    return { ...environment, MONGODB_DATABASE: environment.MONGODB_DATABASE ?? uriDatabase };
  })
  .superRefine((environment, context) => {
    if (environment.OIDC_PROVIDER_ENABLED) {
      for (const name of ["OIDC_SIGNING_KEYSET_JSON", "OIDC_SIGNING_ACTIVE_KID", "OIDC_ADAPTER_HMAC_KEY_BASE64", "OIDC_CLIENT_SECRETS_JSON"] as const) {
        if (!environment[name]) context.addIssue({ code: "custom", path: [name], message: `${name} is required when the OIDC provider is enabled` });
      }
    }
    if (environment.APP_ENV === "preview" && environment.OIDC_PROVIDER_ENABLED) {
      context.addIssue({ code: "custom", path: ["OIDC_PROVIDER_ENABLED"], message: "OIDC is disabled on previews; use an explicitly configured isolated test environment for protocol rehearsal" });
    }
    if (!isProductionGrade(environment.APP_ENV)) return;
    // Staging is the isolated OIDC test environment: every production check
    // applies, plus fail-closed rejection of the production issuer and of any
    // database other than the dedicated staging database.
    const label = environment.APP_ENV === "production" ? "Production" : "Staging";
    if (!environment.IDENTITY_ISSUER_URL.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: `${label} issuer must use HTTPS` });
    }
    for (const name of ["SESSION_HMAC_KEY_BASE64", "RATE_LIMIT_HMAC_KEY_BASE64"] as const) {
      if (!environment[name]) context.addIssue({ code: "custom", path: [name], message: `${name} is required in ${label.toLowerCase()}` });
    }
    if (environment.APP_ENV === "production" && environment.IDENTITY_ISSUER_URL !== PRODUCTION_IDENTITY_ISSUER) {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: `Production issuer must be ${PRODUCTION_IDENTITY_ISSUER}` });
    }
    if (environment.APP_ENV === "staging") {
      if (sameIssuerHost(environment.IDENTITY_ISSUER_URL, PRODUCTION_IDENTITY_ISSUER)) {
        context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: `Staging must never use the production issuer host ${new URL(PRODUCTION_IDENTITY_ISSUER).host}` });
      }
      if (environment.MONGODB_DATABASE !== STAGING_IDENTITY_DATABASE) {
        context.addIssue({ code: "custom", path: ["MONGODB_DATABASE"], message: `Staging must use exactly the ${STAGING_IDENTITY_DATABASE} database` });
      }
    }
    for (const name of ["SESSION_HMAC_KEY_BASE64", "RATE_LIMIT_HMAC_KEY_BASE64", "OIDC_ADAPTER_HMAC_KEY_BASE64"] as const) {
      const value = environment[name];
      if (value && Buffer.from(value, "base64").byteLength < 32) {
        context.addIssue({ code: "custom", path: [name], message: `${name} must decode to at least 32 bytes` });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(values);
}
