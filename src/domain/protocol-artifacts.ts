import type { IdentitySubject } from "./identity";

export interface AuthorizationCodeRecord {
  /** SHA-256 or keyed hash of the bearer code; never store the raw code. */
  codeHash: string;
  identitySubject: IdentitySubject;
  clientId: string;
  redirectUri: string;
  scope: readonly string[];
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface RefreshTokenRecord {
  /** Keyed hash of the bearer token; never store the raw token. */
  tokenHash: string;
  familyId: string;
  identitySubject: IdentitySubject;
  clientId: string;
  scope: readonly string[];
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
}
