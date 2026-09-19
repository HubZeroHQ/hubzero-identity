import { AccountShell } from "@/components/account-shell";
import { DeviceIcon } from "@/components/icons";
import { Button, PageHeader, Status } from "@/components/ui";
import styles from "../account.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsPage() {
  return <AccountShell current="Sessions"><PageHeader title="Sessions" description="Devices where your HubZero Account is currently signed in." />
    <div aria-label="Active sessions">
      <article className={styles.session}><span className={styles.sessionIcon}><DeviceIcon /></span><div><strong>Chrome on Windows <Status tone="success">Current</Status></strong><p>Bengaluru area · Active now · Started today</p></div><button type="button">Sign out</button></article>
      <article className={styles.session}><span className={styles.sessionIcon}><DeviceIcon /></span><div><strong>Safari on iPhone</strong><p>Bengaluru area · Active 2 days ago · Started 3 Sep</p></div><button type="button">Sign out</button></article>
    </div>
    <div className={styles.dangerZone}><div><strong>Sign out everywhere</strong><p>Ends every HubZero Account session, including this one.</p></div><Button tone="danger">Sign out everywhere</Button></div>
  </AccountShell>;
}
