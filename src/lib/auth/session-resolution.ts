import type { IdentityRuntime } from "./runtime";
import type { IdentityUser } from "@/domain/identity";
import { identityUsersCollection } from "@/lib/db/collections";

export interface ResolvedIdentitySession {
  user: IdentityUser;
  sessionId: string;
  needsRotation: boolean;
  authenticatedAt: Date;
}

/** Shared server-only-in-practice resolver for Next and the native OIDC server. */
export async function resolveIdentitySessionToken(runtime: IdentityRuntime, token: string | null | undefined): Promise<ResolvedIdentitySession | null> {
  if (!token) return null;
  const session = await runtime.sessions.validate(token, { allowRotation: false });
  if (!session) return null;
  const user = await identityUsersCollection(runtime.database).findOne({ subject: session.identitySubject });
  if (!user || user.status !== "active") return null;
  return { user, sessionId: session.sessionId, needsRotation: session.needsRotation, authenticatedAt: session.authenticatedAt };
}
