import Link from "next/link";
import { AccountShell } from "@/components/account-shell";
import { ArrowIcon, CheckIcon } from "@/components/icons";
import { PageHeader, Status } from "@/components/ui";
import { getAccountData } from "@/lib/auth/account-data";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import styles from "./account.module.css";

export default async function AccountOverview({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const identity = await requireFullAccountIdentity("/");
  const [data, query] = await Promise.all([getAccountData(identity.user.subject, identity.sessionId), searchParams]);
  const initials = identity.user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "HZ";
  return <AccountShell current="Account" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Your account" description="The identity you use across HubZero products." />
    {query.notice === "password-changed" ? <p className={styles.note} role="status">Your password was changed. Other sessions were signed out.</p> : null}
    <section className={styles.identity} aria-labelledby="identity-name">
      <div className={styles.portrait} aria-hidden="true">{initials}</div>
      <div><h2 id="identity-name">{identity.user.name}</h2><p>{identity.user.email}</p><Status tone="success">Active {identity.user.accountType} account</Status></div>
    </section>
    <section className={styles.section} aria-labelledby="account-details">
      <div className={styles.sectionHead}><h2 id="account-details">Account details</h2><Link href="/profile">Edit profile</Link></div>
      <div className={styles.facts}>
        <div className={styles.fact}><span>Email</span><strong>{identity.user.emailVerifiedAt ? "Verified" : "Verification pending"}</strong></div>
        <div className={styles.fact}><span>Password</span><strong>{data.credential ? `Updated ${formatDate(data.credential.passwordChangedAt)}` : "Unavailable"}</strong></div>
        <div className={styles.fact}><span>Sessions</span><strong>{data.sessions.length} active</strong></div>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="connected-apps">
      <div className={styles.sectionHead}><h2 id="connected-apps">Applications</h2><Link href="/applications">View all</Link></div>
      {data.memberships.length ? <div className={styles.appList}>{data.memberships.filter(({ membership }) => membership.status === "active").slice(0, 3).map(({ membership, application }) => <Link href="/applications" className={styles.app} key={membership.applicationId}><span className={styles.appMark}>{application?.brand.mark ?? application?.displayName.slice(0, 1) ?? "H"}</span><span><strong>{application?.displayName ?? "HubZero application"}</strong><small>{application?.visibility === "internal" ? "Internal" : "Private"} · Active membership</small></span><ArrowIcon size={16}/></Link>)}</div> : <p className={styles.empty}>Your account is not currently associated with a HubZero application.</p>}
    </section>
    <section className={styles.section} aria-labelledby="security-check">
      <div className={styles.sectionHead}><h2 id="security-check">Security</h2><Link href="/security">Review security</Link></div>
      <div className={styles.security}><span className={styles.securityIcon}><CheckIcon /></span><div><strong>Your password is current</strong><p>Review active sessions if you see a browser you do not recognize.</p></div></div>
    </section>
  </AccountShell>;
}

function formatDate(value: Date): string { return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(value); }
