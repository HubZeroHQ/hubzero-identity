import type { IdentitySubject } from "./identity";

export type PasswordAlgorithm = "argon2id" | "bcrypt";

export interface PasswordCredential {
  id: string;
  identitySubject: IdentitySubject;
  type: "password";
  passwordHash: string;
  algorithm: PasswordAlgorithm;
  algorithmParameters: Readonly<Record<string, string | number>>;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Argon2idParameters {
  [key: string]: string | number;
  version: 19;
  memoryCostKiB: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
}

export interface BcryptParameters {
  [key: string]: string | number;
  version: "2a" | "2b";
  cost: number;
}

export const passwordPolicy = {
  minimumCharacters: 12,
  maximumUtf8Bytes: 1024,
  allowPassphrases: true,
  rejectKnownCompromisedPasswords: true,
  compositionRules: false,
} as const;

export function passwordUtf8Length(password: string): number {
  return new TextEncoder().encode(password).byteLength;
}

export function validatePasswordLength(password: string): string | null {
  const characters = [...password].length;
  if (characters < passwordPolicy.minimumCharacters) {
    return `Use at least ${passwordPolicy.minimumCharacters} characters.`;
  }
  if (passwordUtf8Length(password) > passwordPolicy.maximumUtf8Bytes) {
    return "Password is too long.";
  }
  return null;
}
