import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env";

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
