import Link from "next/link";
import { Brand } from "./brand";
import { DeviceIcon, GridIcon, OverviewIcon, ShieldIcon, UserIcon } from "./icons";
import styles from "./account-shell.module.css";

const navigation = [
  { href: "/", label: "Account", icon: OverviewIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
  { href: "/security", label: "Security", icon: ShieldIcon },
  { href: "/sessions", label: "Sessions", icon: DeviceIcon },
  { href: "/applications", label: "Applications", icon: GridIcon },
] as const;

export function AccountShell({ current, children }: { current: string; children: React.ReactNode }) {
  return (
    <div className={styles.frame}>
      <aside className={styles.rail}>
        <div className={styles.brand}><Brand /></div>
        <nav aria-label="Account navigation" className={styles.nav}>
          {navigation.map(({ href, label, icon: NavIcon }) => (
            <Link key={href} href={href} aria-current={current === label ? "page" : undefined} className={current === label ? styles.current : undefined}>
              <NavIcon size={17} /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">AR</span>
          <span><strong>Aarav Rao</strong><small>aarav@hubzero.in</small></span>
        </div>
      </aside>
      <div className={styles.mobileHeader}><Brand /><span className={styles.preview}>Design preview</span></div>
      <nav className={styles.mobileNav} aria-label="Account navigation">
        {navigation.map(({ href, label }) => <Link key={href} href={href} aria-current={current === label ? "page" : undefined}>{label}</Link>)}
      </nav>
      <main id="main-content" className={styles.content}>
        <div className={styles.previewDesktop}>Design preview · no live account data</div>
        {children}
      </main>
    </div>
  );
}
