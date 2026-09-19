import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { signOutAction } from "@/app/actions";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection } from "@/lib/db/collections";
import { getIdentityRuntime } from "@/lib/auth/runtime";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import { decodeRequiredBase64Key } from "@/lib/security/crypto";
import { OidcInteractionContinuationService, oidcContinuationCookieName } from "@/lib/oidc/interaction-continuation";
import styles from "@/app/sign-in/sign-in.module.css";

export const metadata: Metadata = { title: "Continue", robots: { index: false, follow: false } };

export default async function AuthorizationInteractionPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const runtime = await getIdentityRuntime();
  const continuation = await new OidcInteractionContinuationService(
    runtime.database,
    decodeRequiredBase64Key(runtime.environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64"),
  ).find((await cookies()).get(oidcContinuationCookieName(runtime.environment.APP_ENV))?.value);
  if (!continuation) redirect("/sign-in");
  const identity = await requireFullAccountIdentity("/authorize/interaction");
  const application = await identityApplicationsCollection(runtime.database).findOne({ clientId: continuation.clientId });
  const membership = application ? await identityMembershipsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, applicationId: application.id, status: "active" }) : null;
  const denied = (await searchParams).denied === "1" || !application?.enabled || !membership;
  if (denied) {
    if (application) await runtime.events.append("oidc.authorization_denied", { clientId: application.clientId, reason: "membership_unavailable" }, { targetSubject: identity.user.subject, applicationId: application.id, outcome: "failure", reasonCode: "membership_unavailable" }).catch(() => undefined);
    return <AuthShell>
      <header className={styles.heading}><h1>Access unavailable</h1><p>Your HubZero Account doesn&apos;t have access to {application?.displayName ?? "this HubZero application"}.</p></header>
      <p className={styles.help}>Signed in as {identity.user.email}</p>
      <form action={signOutAction} className={styles.form}><button className={styles.continue} type="submit">Use another account</button></form>
    </AuthShell>;
  }
  const credential = await identityCredentialsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  if (credential?.mustChangePassword) redirect("/change-password?forced=1&returnTo=%2Fauthorize%2Finteraction");
  return <AuthShell>
    <header className={styles.heading}>
      <h1>Continue to</h1>
      <p>{application.displayName}</p>
      <p className={styles.help}>{application.brand.homeUrl}</p>
    </header>
    <form className={styles.form} action={`/interaction/${encodeURIComponent(continuation.interactionUid)}/continue`} method="post">
      <button className={styles.continue} type="submit">Continue with HubZero</button>
    </form>
  </AuthShell>;
}
