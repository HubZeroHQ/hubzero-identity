import { z } from "zod";

const optionalSecret = z.string().min(1).optional();
const booleanFlag = z.enum(["true", "false"]).optional().transform((value) => value === "true");

export const environmentSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "preview", "production"]),
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
    if (environment.APP_ENV !== "production") return;
    if (!environment.IDENTITY_ISSUER_URL.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: "Production issuer must use HTTPS" });
    }
    for (const name of ["SESSION_HMAC_KEY_BASE64", "RATE_LIMIT_HMAC_KEY_BASE64"] as const) {
      if (!environment[name]) context.addIssue({ code: "custom", path: [name], message: `${name} is required in production` });
    }
    if (environment.IDENTITY_ISSUER_URL !== "https://auth.hubzero.in") {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: "Production issuer must be https://auth.hubzero.in" });
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
