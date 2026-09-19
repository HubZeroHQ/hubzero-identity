import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";
import styles from "./unauthorized.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Access unavailable" };

export default function AccessUnavailablePage() {
  return <AuthShell application={{ name: "HubZero Studio", domain: "hubzero.in", initial: "S" }}>
    <div className={styles.block}><span className={styles.code}>403</span><h1>Access unavailable</h1><p>Your HubZero Account doesn’t have access to HubZero Studio.</p></div>
    <div className={styles.signedIn}><small>Signed in as</small><strong>aarav@hubzero.in</strong></div>
    <div className={styles.actions}><Button>Return</Button><button type="button">Sign in with another account</button></div>
  </AuthShell>;
}
