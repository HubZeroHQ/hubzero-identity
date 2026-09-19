"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AccountPasswordService, ConcurrentPasswordChangeError, CurrentPasswordRejectedError } from "@/lib/credentials/account-password";
import { PasswordPolicyError } from "@/lib/credentials/password";
import { identityCredentialsCollection } from "@/lib/db/collections";
import { ProfileService } from "@/lib/identity/profile";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin, safeReturnPath } from "@/lib/auth/origin";
import { authenticateWithPassword } from "@/lib/auth/authentication";
import { summarizeUserAgent, trustedIpPrefix } from "@/lib/auth/request-metadata";
import { getCurrentIdentity, requireCurrentIdentity, requireFullAccountIdentity } from "@/lib/auth/session-context";
import { getIdentityRuntime } from "@/lib/auth/runtime";
import { decodeRequiredBase64Key } from "@/lib/security/crypto";

export interface SignInActionState {
  error?: "invalid" | "rate_limited" | "unavailable" | "suspended";
  retryAfterSeconds?: number;
  email?: string;
  attempt?: number;
}

export async function signInAction(_: SignInActionState, formData: FormData): Promise<SignInActionState> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  try { assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment); } catch { return { error: "unavailable" }; }
  const email = formValue(formData, "email", 320);
  const password = formValue(formData, "password", 4_096);
  const returnTo = safeReturnPath(formValue(formData, "returnTo", 2_000));
  if (!email || !password) return { error: "invalid", email, attempt: Date.now() };
  const result = await authenticateWithPassword({
    email,
    password,
    userAgent: summarizeUserAgent(requestHeaders.get("user-agent")),
    ipPrefix: trustedIpPrefix(requestHeaders.get("x-forwarded-for"), runtime.environment),
  });
  if (result.outcome !== "authenticated") {
    return { error: result.outcome === "rate_limited" ? "rate_limited" : result.outcome, retryAfterSeconds: result.outcome === "rate_limited" ? result.retryAfterSeconds : undefined, email, attempt: Date.now() };
  }
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(runtime.environment), result.token, sessionCookieOptions(runtime.environment, result.absoluteExpiresAt));
  const credentials = await identityCredentialsCollection(runtime.database).findOne({ identitySubject: result.identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  redirect((credentials?.mustChangePassword ? "/change-password?forced=1" : returnTo) as Route);
}

export async function signOutAction(): Promise<void> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment);
  const identity = await getCurrentIdentity();
  if (identity) await runtime.sessions.revoke(identity.sessionId, identity.user.subject, "user_logout");
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(runtime.environment), "", sessionCookieOptions(runtime.environment));
  redirect("/sign-in?notice=signed-out");
}

export interface PasswordActionState { error?: "current" | "policy" | "confirmation" | "unavailable"; message?: string; attempt?: number }

export async function changePasswordAction(_: PasswordActionState, formData: FormData): Promise<PasswordActionState> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  try { assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment); } catch { return { error: "unavailable", attempt: Date.now() }; }
  const identity = await requireCurrentIdentity("/change-password");
  const currentPassword = formValue(formData, "currentPassword", 4_096);
  const newPassword = formValue(formData, "newPassword", 4_096);
  const confirmation = formValue(formData, "confirmation", 4_096);
  if (!currentPassword) return { error: "current", attempt: Date.now() };
  if (newPassword !== confirmation) return { error: "confirmation", attempt: Date.now() };
  const credential = await identityCredentialsCollection(runtime.database).findOne({ identitySubject: identity.user.subject, type: "password" }, { projection: { mustChangePassword: 1 } });
  try {
    const passwordService = new AccountPasswordService(runtime.database, runtime.client, runtime.passwords, decodeRequiredBase64Key(runtime.environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64"), runtime.events);
    const result = await passwordService.change({
      identitySubject: identity.user.subject,
      currentPassword,
      newPassword,
      forced: credential?.mustChangePassword === true,
      userAgentSummary: summarizeUserAgent(requestHeaders.get("user-agent")),
      ipPrefix: trustedIpPrefix(requestHeaders.get("x-forwarded-for"), runtime.environment),
    });
    (await cookies()).set(sessionCookieName(runtime.environment), result.token, sessionCookieOptions(runtime.environment, result.absoluteExpiresAt));
  } catch (error) {
    if (error instanceof CurrentPasswordRejectedError) return { error: "current", attempt: Date.now() };
    if (error instanceof PasswordPolicyError) return { error: "policy", message: error.message, attempt: Date.now() };
    if (error instanceof ConcurrentPasswordChangeError) return { error: "unavailable", attempt: Date.now() };
    return { error: "unavailable", attempt: Date.now() };
  }
  revalidatePath("/");
  redirect("/?notice=password-changed");
}

export interface ProfileActionState { error?: string; success?: boolean; attempt?: number }

export async function updateProfileAction(_: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  try { assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment); } catch { return { error: "Unable to save changes right now.", attempt: Date.now() }; }
  const identity = await requireFullAccountIdentity("/profile");
  try {
    await new ProfileService(runtime.database, runtime.client, runtime.events).changeName(identity.user.subject, formValue(formData, "name", 240));
  } catch {
    return { error: "Enter a name between 1 and 120 characters.", attempt: Date.now() };
  }
  revalidatePath("/");
  revalidatePath("/profile");
  return { success: true, attempt: Date.now() };
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment);
  const identity = await requireFullAccountIdentity("/sessions");
  const sessionId = formValue(formData, "sessionId", 80);
  if (sessionId && sessionId !== identity.sessionId) await runtime.sessions.revokeOwned(identity.user.subject, sessionId, "user_revoked_session");
  revalidatePath("/sessions");
  redirect("/sessions?notice=session-revoked");
}

export async function signOutOtherSessionsAction(): Promise<void> {
  const runtime = await getIdentityRuntime();
  const requestHeaders = await headers();
  assertTrustedMutationOrigin(requestHeaders.get("origin"), runtime.environment);
  const identity = await requireFullAccountIdentity("/sessions");
  const fresh = await runtime.sessions.replaceAllWithFreshSession({
    identitySubject: identity.user.subject,
    userAgentSummary: summarizeUserAgent(requestHeaders.get("user-agent")),
    ipPrefix: trustedIpPrefix(requestHeaders.get("x-forwarded-for"), runtime.environment),
  }, "user_signed_out_other_sessions");
  (await cookies()).set(sessionCookieName(runtime.environment), fresh.token, sessionCookieOptions(runtime.environment, fresh.absoluteExpiresAt));
  revalidatePath("/");
  redirect("/sessions?notice=other-sessions-signed-out");
}

function formValue(formData: FormData, key: string, maximumLength: number): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, maximumLength) : "";
}
