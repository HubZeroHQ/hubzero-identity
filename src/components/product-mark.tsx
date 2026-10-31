import { StrictImage } from "@/components/strict-image";
import styles from "@/app/account.module.css";

export function ProductMark({ studio, fallback }: { studio: boolean; fallback: string }) {
  return <span className={styles.appMark} aria-hidden="true">{studio ? <StrictImage src="/brand/hubzero-logo-black.svg" alt="" width={32} height={32} /> : fallback}</span>;
}
