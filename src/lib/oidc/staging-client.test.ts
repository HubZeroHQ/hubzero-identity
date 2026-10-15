import { describe, expect, it } from "vitest";
import { assessProductionStudioClient, planStagingStudioClient } from "./staging-client";

// Dummy values only; no real host, client or secret is implied.
const valid = {
  issuer: "https://identity-staging.example.test",
  database: "hubzero_identity_staging",
  clientId: "hubzero-studio-test",
  callback: "https://studio-preview.example.test/studio/oidc/callback",
  secretReference: "studio-test",
};

describe("planStagingStudioClient (plan PRE-07)", () => {
  it("plans a dedicated test client for the staging database", () => {
    expect(planStagingStudioClient(valid)).toEqual({
      applicationId: "studio-test",
      clientId: "hubzero-studio-test",
      callback: valid.callback,
      secretReference: "studio-test",
    });
  });

  it.each([
    ["the production issuer", { issuer: "https://auth.hubzero.in" }, /production issuer/],
    ["the production issuer host with a path", { issuer: "https://AUTH.hubzero.in/x" }, /production issuer/],
    ["an HTTP issuer", { issuer: "http://identity-staging.example.test" }, /HTTPS/],
    ["a malformed issuer", { issuer: "identity-staging" }, /not a valid URL/],
    ["the production Identity database", { database: "hubzero_identity" }, /hubzero_identity_staging/],
    ["the Studio production database", { database: "hubzero" }, /hubzero_identity_staging/],
    ["the rehearsal database", { database: "hubzero_identity_rehearsal" }, /hubzero_identity_staging/],
    ["the production client ID", { clientId: "hubzero-studio" }, /never hubzero-studio/],
    ["a client ID outside the dedicated namespace", { clientId: "studio" }, /hubzero-studio-<name>/],
    ["the production secret reference", { secretReference: "studio-production" }, /never studio-production/],
    ["the production callback", { callback: "https://hubzero.in/studio/oidc/callback" }, /production Studio callback/],
    ["the www production callback", { callback: "https://www.hubzero.in/studio/oidc/callback" }, /production Studio callback/],
    ["an HTTP callback", { callback: "http://studio-preview.example.test/studio/oidc/callback" }, /HTTPS/],
    ["a callback on another path", { callback: "https://studio-preview.example.test/callback" }, /exactly/],
    ["a callback with a query", { callback: "https://studio-preview.example.test/studio/oidc/callback?x=1" }, /exactly/],
    ["a callback with credentials", { callback: "https://u:p@studio-preview.example.test/studio/oidc/callback" }, /exactly/],
    ["a non-canonical callback", { callback: "https://STUDIO-preview.example.test/studio/oidc/callback" }, /canonical/],
  ])("refuses %s", (_name, override, message) => {
    expect(() => planStagingStudioClient({ ...valid, ...override })).toThrow(message);
  });
});

describe("assessProductionStudioClient (plan PRE-10)", () => {
  const studio = { clientId: "hubzero-studio", enabled: true, redirectUris: ["https://hubzero.in/studio/oidc/callback"], clientType: "confidential_web", clientSecretReference: "studio-production" };
  const other = { clientId: "account", enabled: true, redirectUris: ["https://auth.hubzero.in/account/callback"], clientType: "confidential_web", clientSecretReference: "account" };

  it("proves the production Studio client from the registry alone", () => {
    expect(assessProductionStudioClient([studio, other])).toEqual({ singleEnabledApplicationForCallback: true, clientIdIsHubzeroStudio: true, registrationMatchesContract: true });
  });

  it("fails when a second enabled client can complete the production callback", () => {
    expect(assessProductionStudioClient([studio, { ...other, clientId: "hubzero-studio-legacy", redirectUris: ["https://hubzero.in/studio/oidc/callback"] }]).singleEnabledApplicationForCallback).toBe(false);
  });

  it("ignores disabled clients", () => {
    expect(assessProductionStudioClient([studio, { ...studio, clientId: "old", enabled: false }]).singleEnabledApplicationForCallback).toBe(true);
  });

  it("fails when the only client for the callback is not hubzero-studio", () => {
    expect(assessProductionStudioClient([{ ...studio, clientId: "studio-x" }]).clientIdIsHubzeroStudio).toBe(false);
  });

  it("fails when nothing serves the callback", () => {
    expect(assessProductionStudioClient([other])).toEqual({ singleEnabledApplicationForCallback: false, clientIdIsHubzeroStudio: false, registrationMatchesContract: false });
  });

  it("flags a registration that drifted from the contract", () => {
    expect(assessProductionStudioClient([{ ...studio, redirectUris: [...studio.redirectUris, "https://evil.example.test/cb"] }]).registrationMatchesContract).toBe(false);
  });
});
