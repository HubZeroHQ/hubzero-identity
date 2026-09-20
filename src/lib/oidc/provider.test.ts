import { describe, expect, it } from "vitest";
import { parseSigningKeySet } from "./provider";

const oldPublicKey = { kty: "EC", crv: "P-256", x: "old-x", y: "old-y", kid: "old", alg: "ES256", use: "sig" };
const newPrivateKey = { kty: "EC", crv: "P-256", x: "new-x", y: "new-y", d: "private-test-material", kid: "new", alg: "ES256", use: "sig" };

describe("OIDC signing key selection", () => {
  it("places the explicitly selected private key first while retaining previous public keys", () => {
    const keyset = parseSigningKeySet(JSON.stringify({ keys: [oldPublicKey, newPrivateKey] }), "new");

    expect(keyset.keys.map((key) => key.kid)).toEqual(["new", "old"]);
    expect(keyset.keys[1]).not.toHaveProperty("d");
  });

  it("fails closed when the active key is absent or not a usable private ES256 signing key", () => {
    expect(() => parseSigningKeySet(JSON.stringify({ keys: [oldPublicKey] }), "missing")).toThrow(/ACTIVE_KID/);
    expect(() => parseSigningKeySet(JSON.stringify({ keys: [oldPublicKey] }), "old")).toThrow(/ACTIVE_KID/);
  });
});
