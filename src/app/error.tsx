"use client";

import { AuthShell } from "@/components/auth-shell";
import styles from "@/app/sign-in/sign-in.module.css";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return <AuthShell>
    <header className={styles.heading}><h1>Account temporarily unavailable</h1><p>HubZero Account could not complete that request. Try again shortly.</p></header>
    <button className={styles.continue} type="button" onClick={reset}>Try again</button>
  </AuthShell>;
}
