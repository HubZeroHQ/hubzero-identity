import Link from "next/link";
import { Brand } from "./brand";
import { DeviceIcon, GridIcon, OverviewIcon, ShieldIcon, UserIcon } from "./icons";
import { signOutAction } from "@/app/actions";
import { SessionRefresh } from "./session-refresh";
import styles from "./account-shell.module.css";

const navigation = [
  { href: "/", label: "Account", icon: OverviewIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
  { href: "/security", label: "Security", icon: ShieldIcon },
  { href: "/sessions", label: "Sessions", icon: DeviceIcon },
  { href: "/applications", label: "Applications", icon: GridIcon },
] as const;

export function AccountShell({ current, user, needsRotation = false, children }: { current: string; user: { name: string; email: string }; needsRotation?: boolean; children: React.ReactNode }) {
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "HZ";
  return (
    <div className={styles.frame}>
      <SessionRefresh needed={needsRotation} />
      <aside className={styles.rail}>
        <Link href="/" className={styles.brand} aria-label="HubZero Account home"><Brand /></Link>
        <nav aria-label="Account navigation" className={styles.nav}>
          {navigation.map(({ href, label, icon: NavIcon }) => (
            <Link key={href} href={href} aria-current={current === label ? "page" : undefined} className={current === label ? styles.current : undefined}>
              <NavIcon size={17} /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <span><strong>{user.name}</strong><small>{user.email}</small></span>
        </div>
        <form className={styles.signOut} action={signOutAction}><button type="submit">Sign out</button></form>
      </aside>
      <main id="main-content" tabIndex={-1} className={styles.content}>
        {children}
      </main>
    </div>
  );
}
