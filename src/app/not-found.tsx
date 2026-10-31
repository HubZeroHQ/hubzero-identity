import Link from "next/link";
import { Brand } from "@/components/brand";
import styles from "@/app/status.module.css";

export default function NotFound() {
  return <main className={styles.page}><div className={styles.content}><Brand /><h1 className={styles.heading}>Page not found</h1><p className={styles.muted}>This page isn’t part of HubZero Account.</p><Link href="/" className={styles.link}>Return to your account</Link></div></main>;
}
