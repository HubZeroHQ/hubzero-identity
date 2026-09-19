import { describe, expect, it } from "vitest";
import { buildRateLimitBucketId, consumeWithFailurePolicy, RateLimitStorageError } from "@/lib/rate-limit/rate-limiter";
import { generateIdentitySubject } from "@/lib/identity/subject";
import { hashSessionSecret, parseSessionToken } from "@/lib/sessions/session-secret";
import { identitySessionCookie } from "@/lib/sessions/service";

describe("security primitives", () => {
  const key = Buffer.alloc(32, 7);

  it("generates valid, distinct opaque subjects", () => {
    const first = generateIdentitySubject(new Date("2026-01-01T00:00:00Z"));
    const second = generateIdentitySubject(new Date("2026-01-01T00:00:00Z"));
    expect(first).toMatch(/^hz_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second).not.toBe(first);
  });

  it("parses only correctly shaped session tokens and derives stable hashes", () => {
    const id = "ses_01J8Y80J3QY33NZ7J7D8FV1J0M";
    const secret = "a".repeat(43);
    expect(parseSessionToken(`${id}.${secret}`)).toEqual({ sessionId: id, secret });
    expect(parseSessionToken("bad")).toBeNull();
    expect(hashSessionSecret(id, secret, key)).toBe(hashSessionSecret(id, secret, key));
    expect(hashSessionSecret(id, "b".repeat(43), key)).not.toBe(hashSessionSecret(id, secret, key));
  });

  it("constructs opaque, namespaced rate-limit keys", () => {
    const first = buildRateLimitBucketId("login.account", "person@example.com", key);
    expect(first).not.toContain("person@example.com");
    expect(first).not.toBe(buildRateLimitBucketId("login.ip", "person@example.com", key));
  });

  it("keeps the Identity cookie host-only and inaccessible to browser scripts", () => {
    expect(identitySessionCookie).toMatchObject({ name: "__Host-hz_session", httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: undefined });
  });

  it("applies explicit storage failure policy", async () => {
    const limiter = { consume: async () => { throw new RateLimitStorageError(new Error("offline")); } };
    const request = { namespace: "login.ip", key: "x", limit: 2, windowSeconds: 60 };
    await expect(consumeWithFailurePolicy(limiter, request, "fail_closed")).resolves.toMatchObject({ allowed: false, storageUnavailable: true });
    await expect(consumeWithFailurePolicy(limiter, request, "fail_open")).resolves.toMatchObject({ allowed: true, storageUnavailable: true });
  });
});
