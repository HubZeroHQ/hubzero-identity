import Link from "next/link";
import { AccountShell } from "@/components/account-shell";
import { ArrowIcon, CheckIcon } from "@/components/icons";
import { PageHeader, Status } from "@/components/ui";
import styles from "./account.module.css";

export default function AccountOverview() {
  return <AccountShell current="Account">
    <PageHeader title="Your account" description="The identity you use across HubZero products." />
    <section className={styles.identity} aria-labelledby="identity-name">
      <div className={styles.portrait} aria-hidden="true">AR</div>
      <div><h2 id="identity-name">Aarav Rao</h2><p>aarav@hubzero.in</p><Status tone="success">Active internal account</Status></div>
    </section>
    <section className={styles.section} aria-labelledby="account-details">
      <div className={styles.sectionHead}><h2 id="account-details">Account details</h2><Link href="/profile">Edit profile</Link></div>
      <div className={styles.facts}>
        <div className={styles.fact}><span>Email</span><strong>Verified</strong></div>
        <div className={styles.fact}><span>Password</span><strong>Updated 12 Aug</strong></div>
        <div className={styles.fact}><span>Sessions</span><strong>2 active</strong></div>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="connected-apps">
      <div className={styles.sectionHead}><h2 id="connected-apps">Applications</h2><Link href="/applications">View all</Link></div>
      <div className={styles.appList}>
        <div className={styles.app}><span className={styles.appMark}>S</span><span><strong>HubZero Studio</strong><small>Internal · Studio manages your role</small></span><ArrowIcon size={16}/></div>
        <div className={styles.app}><span className={styles.appMark}>F</span><span><strong>HubZero Fitness</strong><small>Private · Active membership</small></span><ArrowIcon size={16}/></div>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="security-check">
      <div className={styles.sectionHead}><h2 id="security-check">Security check</h2><Link href="/security">Review security</Link></div>
      <div className={styles.security}><span className={styles.securityIcon}><CheckIcon /></span><div><strong>Your password is current</strong><p>Review active sessions if you see a device you do not recognize.</p></div></div>
    </section>
  </AccountShell>;
}
