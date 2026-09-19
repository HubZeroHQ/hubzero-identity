import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { safeReturnPath } from "@/lib/auth/origin";
import { getCurrentIdentity } from "@/lib/auth/session-context";
import { SignInForm } from "./sign-in-form";
import { StaleSessionCleanup } from "@/components/stale-session-cleanup";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; notice?: string }> }) {
  const current = await getCurrentIdentity();
  if (current) redirect("/");
  const query = await searchParams;
  return <AuthShell>
    <StaleSessionCleanup />
    <header className={styles.heading}><h1>Welcome back</h1><p>Use your HubZero Account to continue.</p></header>
    {query.notice === "signed-out" ? <p className={styles.success} role="status">You have signed out.</p> : null}
    <SignInForm returnTo={safeReturnPath(query.returnTo)} />
  </AuthShell>;
}
