import { describe, expect, it } from "vitest";
import { asIdentitySubject } from "./identity";
import { isExactRedirectUriAllowed } from "./oauth";
import { assertSafeEventMetadata } from "./security-events";
import { isSessionUsable, type IdentitySession } from "./sessions";
import { validatePasswordLength } from "./credentials";

describe("identity contracts", () => {
  it("accepts only prefixed ULID subjects", () => {
    expect(asIdentitySubject("hz_01J8Y80J3QY33NZ7J7D8FV1J0M")).toBeTruthy();
    expect(() => asIdentitySubject("person@example.com")).toThrow();
  });

  it("matches redirect URIs exactly and rejects fragments", () => {
    const allowed = ["https://hubzero.in/auth/callback"];
    expect(isExactRedirectUriAllowed(allowed[0], allowed)).toBe(true);
    expect(isExactRedirectUriAllowed("https://hubzero.in/auth/callback/extra", allowed)).toBe(false);
    expect(isExactRedirectUriAllowed(`${allowed[0]}#fragment`, allowed)).toBe(false);
  });

  it("rejects sensitive security event metadata", () => {
    expect(() => assertSafeEventMetadata({ clientId: "studio", attempt: 2 })).not.toThrow();
    expect(() => assertSafeEventMetadata({ optionalValue: null })).not.toThrow();
    expect(() => assertSafeEventMetadata({ accessToken: "do-not-log" })).toThrow();
    expect(() => assertSafeEventMetadata({ passwordHash: "do-not-log" })).toThrow();
    expect(() => assertSafeEventMetadata({ sessionSecret: "do-not-log" })).toThrow();
    expect(() => assertSafeEventMetadata({ nested: { unsafe: true } })).toThrow();
    expect(() => assertSafeEventMetadata({ unexpected: true }, "session.created")).toThrow();
  });

  it("invalidates sessions when the account session version changes", () => {
    const future = new Date("2030-01-01T00:00:00Z");
    const session = { revokedAt: null, sessionVersion: 3, idleExpiresAt: future, absoluteExpiresAt: future } as IdentitySession;
    expect(isSessionUsable(session, 3, new Date("2029-01-01T00:00:00Z"))).toBe(true);
    expect(isSessionUsable(session, 4, new Date("2029-01-01T00:00:00Z"))).toBe(false);
  });

  it("uses a length policy without composition rules", () => {
    expect(validatePasswordLength("short")).toMatch(/12/);
    expect(validatePasswordLength("a long passphrase with spaces")).toBeNull();
  });
});
