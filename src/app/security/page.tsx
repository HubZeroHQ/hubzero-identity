import { AccountShell } from "@/components/account-shell";
import { Button, Field, PageHeader } from "@/components/ui";
import styles from "../account.module.css";
import { PreviewForm } from "@/components/preview-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return <AccountShell current="Security"><PageHeader title="Security" description="Change your password and review how your account is protected." />
    <PreviewForm className={styles.form}>
      <Field label="Current password" type="password" autoComplete="current-password" />
      <Field label="New password" type="password" autoComplete="new-password" />
      <div className={styles.note}>Use at least 12 characters. A memorable passphrase is a good choice.</div>
      <Field label="Confirm new password" type="password" autoComplete="new-password" />
      <div className={styles.formActions}><Button type="submit">Change password</Button></div>
    </PreviewForm>
  </AccountShell>;
}
