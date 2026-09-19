import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { PageHeader } from "@/components/ui";
import { getAccountData } from "@/lib/auth/account-data";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import { PasswordChangeForm } from "@/app/change-password/password-change-form";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Security", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const identity = await requireFullAccountIdentity("/security");
  const data = await getAccountData(identity.user.subject, identity.sessionId);
  return <AccountShell current="Security" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Security" description="Change your password and review how your account is protected." />
    <section className={styles.section} aria-labelledby="password-heading"><div className={styles.sectionHead}><h2 id="password-heading">Password</h2></div><p className={styles.empty}>Last changed {data.credential ? formatDate(data.credential.passwordChangedAt) : "at an unknown time"}. Changing it signs out your other sessions.</p></section>
    <PasswordChangeForm forced={false} />
  </AccountShell>;
}

function formatDate(value: Date): string { return new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(value); }
