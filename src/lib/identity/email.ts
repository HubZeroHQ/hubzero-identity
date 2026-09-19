import { z } from "zod";

export const EMAIL_NORMALIZATION_VERSION = 1 as const;

const emailSchema = z.email().max(254).regex(/^[\x21-\x7E]+$/, "Email must use ASCII characters in normalization version 1");

export interface NormalizedEmail {
  email: string;
  normalizedEmail: string;
  version: typeof EMAIL_NORMALIZATION_VERSION;
}

export class InvalidEmailError extends Error {
  constructor() {
    super("Email address is invalid");
    this.name = "InvalidEmailError";
  }
}

/**
 * Version 1 trims ASCII/Unicode surrounding whitespace, NFC-normalizes, and
 * lowercases the complete ASCII address. It intentionally does not remove
 * dots, strip plus tags, apply provider aliases, or accept internationalized
 * addresses before an explicit normalization-version migration exists.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  const email = input.trim().normalize("NFC");
  const result = emailSchema.safeParse(email);
  if (!result.success) throw new InvalidEmailError();
  return {
    email,
    normalizedEmail: email.toLowerCase(),
    version: EMAIL_NORMALIZATION_VERSION,
  };
}
