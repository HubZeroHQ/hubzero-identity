import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HubZero Account", template: "%s · HubZero Account" },
  description: "Manage your HubZero Account, security, sessions, and applications.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
