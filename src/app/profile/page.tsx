import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { PageHeader } from "@/components/ui";
import { requireFullAccountIdentity } from "@/lib/auth/session-context";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default async function ProfilePage() {
  const identity = await requireFullAccountIdentity("/profile");
  return <AccountShell current="Profile" user={identity.user} needsRotation={identity.needsRotation}>
    <PageHeader title="Profile" description="Details HubZero products may use to identify you." />
    <ProfileForm name={identity.user.name} email={identity.user.email} />
  </AccountShell>;
}
