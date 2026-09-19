import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { PageHeader, Status } from "@/components/ui";
import { getAccountData } from "@/lib/auth/account-data";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

export default async function ApplicationsPage() {
  const identity = await requireFullAccountIdentity("/applications");
  const data = await getAccountData(identity.user.subject, identity.sessionId);
  return <AccountShell current="Applications" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Applications" description="HubZero products your account is currently associated with." />
    {data.memberships.length ? data.memberships.map(({ membership, application }) => <article className={styles.applicationDetail} key={membership.applicationId}><span className={styles.appMark}>{application?.brand.mark ?? application?.displayName.slice(0, 1) ?? "H"}</span><div><strong>{application?.displayName ?? "HubZero application"}</strong><p>{application ? `${application.visibility === "internal" ? "Internal" : "Private"} · ${application.brand.homeUrl}` : "Application details are unavailable."}</p></div><div className={styles.meta}><Status tone={membership.status === "active" && application?.enabled ? "success" : "warning"}>{membership.status === "active" && application?.enabled ? "Active" : "Unavailable"}</Status></div></article>) : <p className={styles.empty}>Your account is not currently associated with a HubZero application.</p>}
    <section className={styles.section}><p className={styles.empty}>Application access is managed by HubZero. Product membership and future sign-in grants are different actions.</p></section>
  </AccountShell>;
}
