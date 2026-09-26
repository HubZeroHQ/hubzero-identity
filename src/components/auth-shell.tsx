import { Brand } from "./brand";
import styles from "./auth-shell.module.css";

export function AuthShell({ children, application }: { children: React.ReactNode; application?: { name: string; domain: string; initial: string } }) {
  return <div className={styles.page}>
    <header className={styles.header}><a href="https://hubzero.in" aria-label="HubZero home"><Brand /></a><span>Account / Sign in</span></header>
    <main id="main-content" tabIndex={-1} className={styles.stage}>
      <aside className={styles.introduction} aria-label="About HubZero Account">
        <p className={styles.eyebrow}>HubZero Account</p>
        <p className={styles.statement}>One account.<br/><em>Your HubZero.</em></p>
        <p className={styles.description}>One account across your approved HubZero products.</p>
        <div className={styles.context}><span>One place to sign in.</span><span>Each product manages your access.</span></div>
      </aside>
      <section className={styles.panel} aria-label="Authentication">
        {application && <div className={styles.application}><span aria-hidden="true">{application.initial}</span><div><small>Continue to</small><strong>{application.name}</strong><p>{application.domain}</p></div></div>}
        {children}
      </section>
    </main>
    <footer className={styles.footer}><a href="https://hubzero.in">Back to HubZero ↗</a><span>auth.hubzero.in</span></footer>
  </div>;
}
