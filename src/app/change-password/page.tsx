import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { signOutAction } from "@/app/actions";
import { requireCurrentIdentity } from "@/lib/auth/session-context";
import { safeReturnPath } from "@/lib/auth/origin";
import { PasswordChangeForm } from "./password-change-form";
import styles from "@/app/sign-in/sign-in.module.css";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ forced?: string; returnTo?: string }> }) {
  await requireCurrentIdentity("/change-password");
  const query = await searchParams;
  const forced = query.forced === "1";
  return <AuthShell>
    <header className={styles.heading}><h1>{forced ? "Set a new password" : "Change password"}</h1><p>{forced ? "Your account requires a new password before you can continue." : "Choose a new password for your HubZero Account."}</p></header>
    <PasswordChangeForm forced={forced} returnTo={safeReturnPath(query.returnTo)} />
    <form action={signOutAction}><button className={styles.textAction} type="submit">Sign out instead</button></form>
  </AuthShell>;
}
