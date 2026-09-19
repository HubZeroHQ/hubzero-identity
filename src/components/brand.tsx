import styles from "./brand.module.css";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.brand} aria-label="HubZero">
      <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span className={styles.name}>HubZero</span>}
    </div>
  );
}
