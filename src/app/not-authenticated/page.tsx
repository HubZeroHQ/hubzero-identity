import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import styles from "../access-unavailable/unauthorized.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in required" };

export default function NotAuthenticatedPage() {
  return <AuthShell application={{ name: "HubZero Studio", domain: "hubzero.in", initial: "S" }}>
    <div className={styles.block}><h1>Sign in required</h1><p>Sign in with your HubZero Account to continue to HubZero Studio.</p></div>
    <div className={styles.actions}><Link href="/sign-in">Sign in</Link></div>
  </AuthShell>;
}
