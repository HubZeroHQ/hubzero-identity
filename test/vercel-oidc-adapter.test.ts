import { describe, expect, it } from "vitest";
import { canonicalVercelOidcPath } from "../src/lib/oidc/vercel-adapter";

describe("Vercel OIDC rewrite adapter", () => {
  it("removes only the internal function prefix and preserves the protocol URL", () => {
    expect(canonicalVercelOidcPath("/authorize", "/api/oidc/authorize?client_id=client-a&state=state-value")).toBe("/authorize?client_id=client-a&state=state-value");
    expect(canonicalVercelOidcPath("/.well-known/openid-configuration", "/api/oidc/discovery")).toBe("/.well-known/openid-configuration");
  });

  it("does not reinterpret a path that is already canonical", () => {
    expect(canonicalVercelOidcPath("/jwks", "/api/oidc/jwks?cache=1")).toBe("/jwks?cache=1");
  });
});
