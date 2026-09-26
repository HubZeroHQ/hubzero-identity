import { AuthShell } from "@/components/auth-shell";
import Link from "next/link";
import styles from "./unauthorized.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Access unavailable" };

export default function AccessUnavailablePage() {
  return <AuthShell>
    <div className={styles.block}><h1>Access unavailable</h1><p>This request could not be completed. Review your applications or contact your HubZero administrator if you need access.</p></div>
    <div className={styles.actions}><Link href="/applications">Review applications →</Link><Link href="/sign-in">Return to sign in</Link></div>
  </AuthShell>;
}
