import { describe, expect, it } from "vitest";
import { isProductionGrade, parseEnvironment } from "./env";
import { oidcContinuationCookieName, oidcProviderSessionCookieName } from "./oidc/interaction-continuation";

const base = {
  APP_ENV: "development",
  IDENTITY_ISSUER_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/hubzero_identity_dev",
  MONGODB_DATABASE: "hubzero_identity_dev",
};

describe("environment validation", () => {
  it("allows a safe local baseline", () => expect(parseEnvironment(base)).toBeTruthy());
  it("requires HTTPS and secrets in production", () => {
    expect(() => parseEnvironment({ ...base, APP_ENV: "production" })).toThrow();
  });
  it("rejects short production HMAC keys", () => {
    expect(() => parseEnvironment({
      ...base,
      APP_ENV: "production",
      IDENTITY_ISSUER_URL: "https://auth.hubzero.in",
      SESSION_HMAC_KEY_BASE64: Buffer.from("short").toString("base64"),
      RATE_LIMIT_HMAC_KEY_BASE64: Buffer.alloc(32).toString("base64"),
      OIDC_SIGNING_KEYSET_JSON: "{}",
    })).toThrow(/32 bytes/);
  });
  it("requires an explicit active signing key whenever OIDC is enabled", () => {
    expect(() => parseEnvironment({
      ...base,
      OIDC_PROVIDER_ENABLED: "true",
      OIDC_SIGNING_KEYSET_JSON: '{"keys":[]}',
      OIDC_ADAPTER_HMAC_KEY_BASE64: Buffer.alloc(32).toString("base64"),
      OIDC_CLIENT_SECRETS_JSON: '{}',
    })).toThrow(/OIDC_SIGNING_ACTIVE_KID/);
  });
  it("keeps arbitrary Vercel previews out of the OIDC issuer trust boundary", () => {
    expect(() => parseEnvironment({
      ...base,
      APP_ENV: "preview",
      IDENTITY_ISSUER_URL: "https://identity-preview.example.invalid",
      OIDC_PROVIDER_ENABLED: "true",
      OIDC_SIGNING_KEYSET_JSON: '{"keys":[]}',
      OIDC_SIGNING_ACTIVE_KID: "preview",
      OIDC_ADAPTER_HMAC_KEY_BASE64: Buffer.alloc(32).toString("base64"),
      OIDC_CLIENT_SECRETS_JSON: '{}',
    })).toThrow(/disabled on previews/);
  });
});

const key = Buffer.alloc(32, 9).toString("base64");
const staging = {
  APP_ENV: "staging",
  IDENTITY_ISSUER_URL: "https://identity-staging.example.test",
  MONGODB_URI: "mongodb://127.0.0.1:1/hubzero_identity_staging",
  SESSION_HMAC_KEY_BASE64: key,
  RATE_LIMIT_HMAC_KEY_BASE64: key,
  OIDC_PROVIDER_ENABLED: "true",
  OIDC_SIGNING_KEYSET_JSON: '{"keys":[]}',
  OIDC_SIGNING_ACTIVE_KID: "staging-test",
  OIDC_ADAPTER_HMAC_KEY_BASE64: key,
  OIDC_CLIENT_SECRETS_JSON: "{}",
};
const messages = (values: Record<string, string | undefined>) => {
  try {
    parseEnvironment(values);
    return [];
  } catch (error) {
    return (error as { issues?: { message: string }[] }).issues?.map((issue) => issue.message) ?? [String(error)];
  }
};

describe("staging: the isolated OIDC test environment (plan PRE-07)", () => {
  it("accepts a dedicated HTTPS issuer on the staging database with OIDC enabled", () => {
    expect(messages(staging)).toEqual([]);
  });

  it.each([
    "https://auth.hubzero.in",
    "https://AUTH.hubzero.in/",
    "https://auth.hubzero.in:8443",
  ])("rejects the production issuer host (%s)", (issuer) => {
    expect(messages({ ...staging, IDENTITY_ISSUER_URL: issuer })).toContain(
      "Staging must never use the production issuer host auth.hubzero.in",
    );
  });

  it.each(["hubzero_identity", "hubzero", "hubzero_identity_rehearsal", "hubzero_identity_dev"])(
    "rejects the %s database",
    (database) => {
      expect(messages({ ...staging, MONGODB_URI: `mongodb://127.0.0.1:1/${database}` })).toEqual([
        "Staging must use exactly the hubzero_identity_staging database",
      ]);
    },
  );

  it("keeps every production-grade check: HTTPS issuer, required and 32-byte HMAC keys", () => {
    expect(messages({ ...staging, IDENTITY_ISSUER_URL: "http://identity-staging.example.test" })).toContain("Staging issuer must use HTTPS");
    expect(messages({ ...staging, SESSION_HMAC_KEY_BASE64: undefined })).toContain("SESSION_HMAC_KEY_BASE64 is required in staging");
    expect(messages({ ...staging, RATE_LIMIT_HMAC_KEY_BASE64: Buffer.from("short").toString("base64") })).toContain(
      "RATE_LIMIT_HMAC_KEY_BASE64 must decode to at least 32 bytes",
    );
    expect(messages({ ...staging, OIDC_ADAPTER_HMAC_KEY_BASE64: Buffer.from("short").toString("base64") })).toContain(
      "OIDC_ADAPTER_HMAC_KEY_BASE64 must decode to at least 32 bytes",
    );
    expect(messages({ ...staging, OIDC_SIGNING_ACTIVE_KID: undefined })).toContain(
      "OIDC_SIGNING_ACTIVE_KID is required when the OIDC provider is enabled",
    );
  });

  it("leaves production unchanged: the production issuer and wording", () => {
    const production = { ...staging, APP_ENV: "production", IDENTITY_ISSUER_URL: "https://auth.hubzero.in", MONGODB_URI: "mongodb://127.0.0.1:1/hubzero_identity" };
    expect(messages(production)).toEqual([]);
    expect(messages({ ...production, IDENTITY_ISSUER_URL: "https://identity-staging.example.test" })).toEqual([
      "Production issuer must be https://auth.hubzero.in",
    ]);
    expect(messages({ ...production, IDENTITY_ISSUER_URL: "http://auth.hubzero.in" })).toEqual([
      "Production issuer must use HTTPS",
      "Production issuer must be https://auth.hubzero.in",
    ]);
  });

  it("still keeps OIDC off arbitrary previews", () => {
    expect(messages({ ...staging, APP_ENV: "preview" })).toContain(
      "OIDC is disabled on previews; use an explicitly configured isolated test environment for protocol rehearsal",
    );
  });

  it("gives staging production-grade cookie names; development and test keep theirs", () => {
    expect(isProductionGrade("staging")).toBe(true);
    expect(isProductionGrade("production")).toBe(true);
    for (const environment of ["development", "test", "preview"] as const) expect(isProductionGrade(environment)).toBe(false);
    expect(oidcProviderSessionCookieName("staging")).toBe("__Host-hz_oidc");
    expect(oidcContinuationCookieName("staging")).toBe("__Host-hz_oidc_continue");
    expect(oidcProviderSessionCookieName("test")).toBe("hz_oidc_dev");
    expect(oidcContinuationCookieName("preview")).toBe("hz_oidc_continue_dev");
  });
});
