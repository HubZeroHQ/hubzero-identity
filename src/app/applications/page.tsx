import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { PageHeader, Status } from "@/components/ui";
import { ProductMark } from "@/components/product-mark";
import { getAccountData } from "@/lib/auth/account-data";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

export default async function ApplicationsPage() {
  const identity = await requireFullAccountIdentity("/applications");
  const data = await getAccountData(identity.user.subject, identity.sessionId);
  return <AccountShell current="Applications" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Applications" description="HubZero products your account is currently associated with." />
    {data.memberships.length ? data.memberships.map(({ membership, application }) => {
      const active = membership.status === "active" && application?.enabled;
      const home = application?.brand.homeUrl;
      const safeHome = home && /^https:\/\//i.test(home) ? home : null;
      const description = application?.slug === "studio"
        ? "Your workspace for publishing and managing HubZero content."
        : application?.description ?? "Application details are unavailable.";
      return <article className={styles.applicationDetail} key={membership.applicationId}><ProductMark studio={application?.slug === "studio"} fallback={application?.displayName.slice(0, 1) ?? "H"} /><div><strong>{application?.displayName ?? "HubZero application"}</strong><p>{description}</p>{home && <p>{home}</p>}</div><div className={styles.meta}><Status tone={active ? "success" : "warning"}>{active ? "Access enabled" : "Access unavailable"}</Status>{active && safeHome && <a className={styles.textLink} href={safeHome}>Open {application?.displayName} ↗</a>}</div></article>;
    }) : <p className={styles.empty}>No applications are currently available. Contact your HubZero administrator for access.</p>}
    <section className={styles.section}><h2>Access, in context</h2><p className={styles.empty}>Your HubZero Account lets you sign in to these products. Each product decides what you can view and change. Contact your administrator to request access.</p></section>
  </AccountShell>;
}
