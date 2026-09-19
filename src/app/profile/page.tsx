import { AccountShell } from "@/components/account-shell";
import { Button, Field, PageHeader } from "@/components/ui";
import styles from "../account.module.css";
import { PreviewForm } from "@/components/preview-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <AccountShell current="Profile"><PageHeader title="Profile" description="Details HubZero products may use to identify you." />
    <PreviewForm className={styles.form}>
      <Field label="Full name" value="Aarav Rao" autoComplete="name" />
      <Field label="Email" value="aarav@hubzero.in" type="email" autoComplete="email" />
      <div className={styles.note}>Changing your email will require verification. Your account identity stays the same.</div>
      <div className={styles.formActions}><Button type="submit">Save changes</Button><Button tone="secondary">Cancel</Button></div>
    </PreviewForm>
  </AccountShell>;
}
