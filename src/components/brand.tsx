import { StrictImage } from "@/components/strict-image";
import styles from "./brand.module.css";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.brand} aria-label="HubZero">
      <StrictImage src="/brand/hubzero-logo-black.svg" alt="" width={40} height={40} className={styles.mark} priority />
      {!compact && <span className={styles.name}>HubZero <span>Account</span></span>}
    </div>
  );
}
