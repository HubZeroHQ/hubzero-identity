import type { IdentitySubject } from "./identity";

export interface IdentitySession {
  id: string;
  identitySubject: IdentitySubject;
  currentSecretHash: string;
  previousSecretHash: string | null;
  previousSecretValidUntil: Date | null;
  secretHashVersion: number;
  sessionVersion: number;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  userAgentSummary: string | null;
  ipPrefix: string | null;
}

export const sessionPolicy = {
  idleLifetimeSeconds: 60 * 60 * 24 * 7,
  absoluteLifetimeSeconds: 60 * 60 * 24 * 30,
  rotateAfterSeconds: 60 * 60 * 24,
  previousSecretGraceSeconds: 60 * 2,
  activityUpdateAfterSeconds: 60 * 5,
  cookieName: "__Host-hz_session",
  cookie: {
    httpOnly: true,
    secureInProduction: true,
    sameSite: "lax",
    path: "/",
  },
} as const;

export function isSessionUsable(
  session: IdentitySession,
  accountSessionVersion: number,
  now = new Date(),
): boolean {
  return (
    session.revokedAt === null &&
    session.sessionVersion === accountSessionVersion &&
    session.idleExpiresAt > now &&
    session.absoluteExpiresAt > now
  );
}
