import styles from "@/app/status.module.css";

export default function Loading() {
  return <main className={styles.loading} role="status"><span>Loading your account…</span></main>;
}
