import { AccountShell } from "@/components/account-shell";
import { PageHeader, Status } from "@/components/ui";
import styles from "../account.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return <AccountShell current="Applications"><PageHeader title="Applications" description="HubZero products your account is currently associated with." />
    <article className={styles.applicationDetail}><span className={styles.appMark}>S</span><div><strong>HubZero Studio</strong><p>Internal · hubzero.in · Studio manages your role and permissions.</p></div><div className={styles.meta}><Status tone="success">Active</Status></div></article>
    <article className={styles.applicationDetail}><span className={styles.appMark}>F</span><div><strong>HubZero Fitness</strong><p>Private · fitness.hubzero.in · Fitness keeps your workout data.</p></div><div className={styles.meta}><Status tone="success">Active</Status></div></article>
    <section className={styles.section}><p style={{ color: "var(--muted)", fontSize: 12, maxWidth: 620, margin: 0 }}>Application access is managed by HubZero. Ending a sign-in grant and removing product access are different actions.</p></section>
  </AccountShell>;
}
