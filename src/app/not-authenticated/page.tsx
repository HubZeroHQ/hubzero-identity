import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import styles from "../access-unavailable/unauthorized.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in required" };

export default function NotAuthenticatedPage() {
  return <AuthShell application={{ name: "HubZero Studio", domain: "hubzero.in", initial: "S" }}>
    <div className={styles.block}><h1>Sign in required</h1><p>Sign in with your HubZero Account to continue to HubZero Studio.</p></div>
    <Link href="/sign-in" style={{ display: "inline-grid", placeItems: "center", minHeight: 42, padding: "0 17px", borderRadius: "var(--radius-sm)", background: "var(--signal)", color: "white", fontSize: 13, fontWeight: 650 }}>Sign in</Link>
  </AuthShell>;
}
