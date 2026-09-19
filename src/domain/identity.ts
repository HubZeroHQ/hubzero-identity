export type IdentitySubject = string & { readonly __brand: "IdentitySubject" };

export type AccountType = "internal" | "standard";
export type AccountStatus = "active" | "suspended";

export interface IdentityUser {
  /** Opaque, immutable, non-reassigned subject. Never derived from email. */
  subject: IdentitySubject;
  normalizedEmail: string;
  emailNormalizationVersion: number;
  email: string;
  emailVerifiedAt: Date | null;
  name: string;
  imageUrl: string | null;
  accountType: AccountType;
  status: AccountStatus;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export function asIdentitySubject(value: string): IdentitySubject {
  if (!/^hz_[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) {
    throw new Error("Invalid HubZero Identity subject");
  }
  return value as IdentitySubject;
}
