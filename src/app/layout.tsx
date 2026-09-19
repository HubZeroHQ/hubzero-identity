import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HubZero Account", template: "%s · HubZero Account" },
  description: "Manage your HubZero Account, security, sessions, and applications.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
