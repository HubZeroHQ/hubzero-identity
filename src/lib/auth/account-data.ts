import "server-only";

import type { IdentitySubject } from "@/domain/identity";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection } from "@/lib/db/collections";
import { getIdentityRuntime } from "./runtime";

export async function getAccountData(subject: IdentitySubject, currentSessionId: string) {
  const runtime = await getIdentityRuntime();
  const [credential, sessions, memberships] = await Promise.all([
    identityCredentialsCollection(runtime.database).findOne({ identitySubject: subject, type: "password" }, { projection: { passwordChangedAt: 1, mustChangePassword: 1 } }),
    runtime.sessions.listActive(subject, currentSessionId),
    identityMembershipsCollection(runtime.database).find({ identitySubject: subject }).sort({ createdAt: 1 }).toArray(),
  ]);
  const applications = memberships.length
    ? await identityApplicationsCollection(runtime.database).find({ id: { $in: memberships.map((membership) => membership.applicationId) } }).toArray()
    : [];
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  return { credential, sessions, memberships: memberships.map((membership) => ({ membership, application: applicationById.get(membership.applicationId) ?? null })) };
}
