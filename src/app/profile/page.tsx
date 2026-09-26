import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { PageHeader } from "@/components/ui";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import { ProfileForm } from "./profile-form";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default async function ProfilePage() {
  const identity = await requireFullAccountIdentity("/profile");
  return <AccountShell current="Profile" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Profile" description="Details HubZero products may use to identify you." />
    <section className={styles.editor} aria-labelledby="profile-details"><div><h2 id="profile-details">Personal details</h2><p>Your name is shared with approved products. Updating it does not change your account identity or product access.</p></div><ProfileForm name={identity.user.name} email={identity.user.email} /></section>
    <section className={styles.section}><h2>Account identity</h2><p className={styles.empty}>Your account has a permanent, private identifier. It cannot be edited and does not depend on your name or email.</p></section>
  </AccountShell>;
}
