import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

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
    if (environment.APP_ENV !== "production") return;
    if (!environment.IDENTITY_ISSUER_URL.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: "Production issuer must use HTTPS" });
    }
    for (const name of ["SESSION_HMAC_KEY_BASE64", "RATE_LIMIT_HMAC_KEY_BASE64", "OIDC_SIGNING_KEYSET_JSON"] as const) {
      if (!environment[name]) context.addIssue({ code: "custom", path: [name], message: `${name} is required in production` });
    }
    for (const name of ["SESSION_HMAC_KEY_BASE64", "RATE_LIMIT_HMAC_KEY_BASE64"] as const) {
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
