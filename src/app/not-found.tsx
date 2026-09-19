import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><div style={{ maxWidth: 420 }}><Brand /><h1 style={{ marginTop: 60, fontSize: 32, letterSpacing: "-.04em" }}>Page not found</h1><p style={{ color: "var(--muted)" }}>This page isn’t part of HubZero Account.</p><Link href="/" style={{ color: "var(--signal)", fontWeight: 650 }}>Return to your account</Link></div></main>;
}
