import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import type { IdentityUser } from "@/domain/identity";
import { identityCredentialsCollection } from "@/lib/db/collections";
import { getIdentityDatabaseConnection } from "@/lib/db/mongodb";
import { parseEnvironment } from "@/lib/env";
import { sessionCookieName } from "./cookies";
import { getIdentityRuntime } from "./runtime";
import { safeReturnPath } from "./origin";
import { resolveIdentitySessionToken } from "./session-resolution";

export interface CurrentIdentity {
  user: IdentityUser;
  sessionId: string;
  needsRotation: boolean;
  authenticatedAt: Date;
}

export async function getCurrentIdentity(): Promise<CurrentIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName(parseEnvironment(process.env)))?.value;
  // An anonymous page needs no Mongo connection, credential service or session lookup.
  if (!token) return null;
  const runtime = await getIdentityRuntime();
  return resolveIdentitySessionToken(runtime, token);
}

export async function requireCurrentIdentity(returnTo: string): Promise<CurrentIdentity> {
  const identity = await getCurrentIdentity();
  if (!identity) redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
  return identity;
}

export async function requireFullAccountIdentity(returnTo: string): Promise<CurrentIdentity> {
  const identity = await requireCurrentIdentity(returnTo);
  const runtime = await getIdentityRuntime();
  const { database } = await getIdentityDatabaseConnection(runtime.environment);
  const credential = await identityCredentialsCollection(database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  if (credential?.mustChangePassword) {
    const destination = safeReturnPath(returnTo);
    redirect((destination === "/authorize/interaction" ? `/change-password?forced=1&returnTo=${encodeURIComponent(destination)}` : "/change-password?forced=1") as Route);
  }
  return identity;
}

export async function currentRequestHeaders() {
  return headers();
}
