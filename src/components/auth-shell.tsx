import { Brand } from "./brand";
import styles from "./auth-shell.module.css";

export function AuthShell({ children, application }: { children: React.ReactNode; application?: { name: string; domain: string; initial: string } }) {
  return <main className={styles.page}>
    <aside className={styles.identityRail} aria-label="HubZero Account"><Brand /><p>One account.<br/>Explicit access.</p><span>auth.hubzero.in</span></aside>
    <section className={styles.stage}>
      <div className={styles.mobileBrand}><Brand /></div>
      <div className={styles.preview}>Design preview · authentication is not active</div>
      <div className={styles.panel}>
        {application && <div className={styles.application}><span aria-hidden="true">{application.initial}</span><div><small>Continue to</small><strong>{application.name}</strong><p>{application.domain}</p></div></div>}
        {children}
      </div>
      <footer><a href="#privacy">Privacy</a><a href="#help">Help</a></footer>
    </section>
  </main>;
}
