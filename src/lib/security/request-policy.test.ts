import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, isAcceptedHost } from "./request-policy";

const production = { APP_ENV: "production", VERCEL_ENV: "production", IDENTITY_ISSUER_URL: "https://auth.hubzero.in", VERCEL_URL: "hubzero-identity-abc.vercel.app" };
const preview = { APP_ENV: "preview", VERCEL_ENV: "preview", IDENTITY_ISSUER_URL: "https://auth.hubzero.in", VERCEL_URL: "hubzero-identity-abc-team.vercel.app" };

describe("canonical host policy", () => {
  it("accepts only the issuer host in production, after normalization", () => {
    for (const host of ["auth.hubzero.in", "AUTH.HubZero.IN", "auth.hubzero.in.", "auth.hubzero.in:443"]) expect(isAcceptedHost(host, production)).toBe(true);
  });

  it("rejects every other production host, including the deployment's own", () => {
    for (const host of ["hubzero-identity.vercel.app", production.VERCEL_URL, "evil.example", "auth.hubzero.in.evil.example", "auth.hubzero.in:8443", "auth.hubzero.in@evil.example", "auth.hubzero.in,evil.example", "auth.hubzero.in/evil", "", null]) {
      expect(isAcceptedHost(host, production)).toBe(false);
    }
  });

  it("applies to a production application outside Vercel too", () => {
    const portable = { APP_ENV: "production", IDENTITY_ISSUER_URL: "https://auth.hubzero.in" };
    expect(isAcceptedHost("auth.hubzero.in", portable)).toBe(true);
    expect(isAcceptedHost("hubzero-identity.vercel.app", portable)).toBe(false);
  });

  it("accepts only the exact deployment hostname on a preview", () => {
    expect(isAcceptedHost(preview.VERCEL_URL, preview)).toBe(true);
    for (const host of ["auth.hubzero.in", "hubzero-identity.vercel.app", "other-abc-team.vercel.app"]) expect(isAcceptedHost(host, preview)).toBe(false);
  });

  it("keeps localhost access in local environments", () => {
    for (const APP_ENV of ["development", "test"]) expect(isAcceptedHost("localhost:3000", { APP_ENV, IDENTITY_ISSUER_URL: "http://localhost:3000" })).toBe(true);
  });

  it("fails closed when a deployed environment cannot name its host", () => {
    expect(isAcceptedHost("auth.hubzero.in", { APP_ENV: "production" })).toBe(false);
    expect(isAcceptedHost("auth.hubzero.in", { VERCEL_ENV: "preview" })).toBe(false);
    expect(isAcceptedHost("auth.hubzero.in", {})).toBe(false);
    expect(isAcceptedHost("auth.hubzero.in", { APP_ENV: "production", IDENTITY_ISSUER_URL: "not a url" })).toBe(false);
  });

  it("does not let a Vercel deployment fall back to local behavior through APP_ENV", () => {
    expect(isAcceptedHost("evil.example", { ...production, APP_ENV: "test" })).toBe(false);
  });
});

describe("content security policy", () => {
  it("binds scripts and styles to the nonce without unsafe sources in production", () => {
    const policy = contentSecurityPolicy("abc", production, false);
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-abc'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("limits the development exceptions to development builds and keeps the nonce", () => {
    const policy = contentSecurityPolicy("abc", { APP_ENV: "development" }, true);
    expect(policy).toContain("'nonce-abc'");
    expect(policy).toContain("'unsafe-eval'");
  });

  it("does not upgrade requests for a local application served over HTTP", () => {
    expect(contentSecurityPolicy("abc", { APP_ENV: "test" }, false)).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", preview, false)).toContain("upgrade-insecure-requests");
  });
});
