import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { DeviceIcon } from "@/components/icons";
import { PageHeader, Status } from "@/components/ui";
import { ConfirmSessionAction } from "@/components/confirm-session-action";
import { revokeSessionAction, signOutOtherSessionsAction } from "@/app/actions";
import { getAccountData } from "@/lib/auth/account-data";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Sessions", robots: { index: false, follow: false } };

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const identity = await requireFullAccountIdentity("/sessions");
  const [data, query] = await Promise.all([getAccountData(identity.user.subject, identity.sessionId), searchParams]);
  return <AccountShell current="Sessions" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Sessions" description="Browsers where your HubZero Account is currently signed in." />
    {query.notice === "session-revoked" ? <p className={styles.note} role="status">The selected session was signed out.</p> : null}
    {query.notice === "other-sessions-signed-out" ? <p className={styles.note} role="status">Other sessions were signed out. This browser stayed signed in.</p> : null}
    <div aria-label="Active sessions">
      {data.sessions.map((session) => <article className={styles.session} key={session.id}><span className={styles.sessionIcon}><DeviceIcon /></span><div><strong>{session.userAgentSummary ?? "Browser details unavailable"} {session.current ? <Status tone="success">Current</Status> : null}</strong><p>Last active {formatDateTime(session.lastSeenAt)} · Started {formatDate(session.createdAt)}</p><p>Expires {formatDateTime(session.expiresAt)} unless renewed by activity. Times shown in UTC.</p></div>{session.current ? <span className={styles.currentLabel}>This browser</span> : <ConfirmSessionAction action={revokeSessionAction} sessionId={session.id} />}</article>)}
    </div>
    <div className={styles.dangerZone}><div><strong>Sign out other sessions</strong><p>Keep this browser signed in and end every other HubZero Account session. Existing product sessions are managed separately.</p></div><ConfirmSessionAction action={signOutOtherSessionsAction} all disabled={data.sessions.length < 2} /></div>
  </AccountShell>;
}

function formatDate(value: Date): string { return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function formatDateTime(value: Date): string { return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(value); }
