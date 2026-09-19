import styles from "./ui.module.css";

export function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className={styles.pageHeader}><h1>{title}</h1><p>{description}</p></header>;
}

export function Status({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning"; children: React.ReactNode }) {
  return <span className={`${styles.status} ${styles[tone]}`}><i aria-hidden="true" />{children}</span>;
}

export function Button({ children, tone = "primary", type = "button" }: { children: React.ReactNode; tone?: "primary" | "secondary" | "danger"; type?: "button" | "submit" }) {
  return <button className={`${styles.button} ${styles[tone]}`} type={type}>{children}</button>;
}

export function Field({ label, value, type = "text", autoComplete }: { label: string; value?: string; type?: string; autoComplete?: string }) {
  return <label className={styles.field}><span>{label}</span><input type={type} defaultValue={value} autoComplete={autoComplete} /></label>;
}
