import { describe, expect, it } from "vitest";
import { EMAIL_NORMALIZATION_VERSION, InvalidEmailError, normalizeEmail } from "./email";

describe("email normalization v1", () => {
  it("trims, NFC-normalizes, and lowercases canonically", () => {
    const result = normalizeEmail("  User@Example.COM \n");
    expect(result).toEqual({ email: "User@Example.COM", normalizedEmail: "user@example.com", version: EMAIL_NORMALIZATION_VERSION });
  });

  it("does not rewrite dots, plus tags, or provider aliases", () => {
    expect(normalizeEmail("First.Last+work@gmail.com").normalizedEmail).toBe("first.last+work@gmail.com");
  });

  it("rejects invalid addresses", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow(InvalidEmailError);
  });
});
