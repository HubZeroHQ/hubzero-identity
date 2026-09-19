import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

export const environmentSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "preview", "production"]),
    IDENTITY_ISSUER_URL: z.string().url(),
    MONGODB_URI: z.string().min(1),
    MONGODB_DATABASE: z.string().min(1),
    SESSION_SECRET: optionalSecret,
    TRUSTED_PROXIES: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    EMAIL_PROVIDER_API_KEY: optionalSecret,
    OIDC_SIGNING_KEYSET_JSON: optionalSecret,
  })
  .superRefine((environment, context) => {
    if (environment.APP_ENV !== "production") return;
    if (!environment.IDENTITY_ISSUER_URL.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["IDENTITY_ISSUER_URL"], message: "Production issuer must use HTTPS" });
    }
    for (const name of ["SESSION_SECRET", "OIDC_SIGNING_KEYSET_JSON"] as const) {
      if (!environment[name]) context.addIssue({ code: "custom", path: [name], message: `${name} is required in production` });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(values);
}
