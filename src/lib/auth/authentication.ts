import "server-only";

import { identityCredentialsCollection, identityUsersCollection } from "@/lib/db/collections";
import { normalizeEmail } from "@/lib/identity/email";
import { consumeWithFailurePolicy } from "@/lib/rate-limit/rate-limiter";
import { PasswordService } from "@/lib/credentials/password";
import type { CurrentIdentity } from "./session-context";
import { getIdentityRuntime, type IdentityRuntime } from "./runtime";

const dummyPassword = "HubZero Identity dummy verification password 2026";
let dummyHash: Promise<string> | undefined;

export type SignInResult =
  | { outcome: "authenticated"; identity: CurrentIdentity; token: string; absoluteExpiresAt: Date }
  | { outcome: "invalid" }
  | { outcome: "suspended" }
  | { outcome: "rate_limited"; retryAfterSeconds: number }
  | { outcome: "unavailable" };

export async function authenticateWithPassword(input: { email: string; password: string; userAgent: string | null; ipPrefix: string | null }): Promise<SignInResult> {
  const runtime = await getIdentityRuntime();
  return authenticateWithPasswordUsingRuntime(runtime, input);
}

export async function authenticateWithPasswordUsingRuntime(runtime: IdentityRuntime, input: { email: string; password: string; userAgent: string | null; ipPrefix: string | null }): Promise<SignInResult> {
  const identifierKey = normalizedIdentifierKey(input.email);
  const networkKey = input.ipPrefix ?? "unavailable-network";
  const combinedKey = `${networkKey}\u0000${identifierKey}`;
  const decisions = await Promise.all([
    consumeWithFailurePolicy(runtime.rateLimiter, { namespace: "login.identifier", key: identifierKey, limit: 10, windowSeconds: 15 * 60 }, "fail_closed"),
    consumeWithFailurePolicy(runtime.rateLimiter, { namespace: "login.network", key: networkKey, limit: 60, windowSeconds: 15 * 60 }, "fail_closed"),
    consumeWithFailurePolicy(runtime.rateLimiter, { namespace: "login.combined", key: combinedKey, limit: 15, windowSeconds: 15 * 60 }, "fail_closed"),
  ]);
  const denied = decisions.find((decision) => !decision.allowed);
  if (denied) return denied.storageUnavailable ? { outcome: "unavailable" } : { outcome: "rate_limited", retryAfterSeconds: denied.retryAfterSeconds };

  let normalizedEmail: string | null = null;
  try { normalizedEmail = normalizeEmail(input.email).normalizedEmail; } catch { /* Dummy verification below deliberately matches this path. */ }
  const account = normalizedEmail ? await identityUsersCollection(runtime.database).findOne({ normalizedEmail }) : null;
  const credential = account ? await identityCredentialsCollection(runtime.database).findOne({ identitySubject: account.subject, type: "password" }) : null;
  if (!account || !credential) {
    await verifyDummyPassword(runtime.passwords, input.password);
    return { outcome: "invalid" };
  }

  let verification;
  try {
    verification = await runtime.credentials.verifyAndUpgrade(account.subject, input.password);
  } catch {
    return { outcome: "unavailable" };
  }
  if (!verification.valid) return { outcome: "invalid" };
  if (account.status !== "active") {
    await runtime.events.append("login.failed", { reason: "account_unavailable_after_verification" }, { targetSubject: account.subject, outcome: "failure", reasonCode: "account_unavailable" });
    return { outcome: "suspended" };
  }
  try {
    const created = await runtime.sessions.create({ identitySubject: account.subject, userAgentSummary: input.userAgent, ipPrefix: input.ipPrefix }, {
      type: "login.succeeded",
      metadata: { credentialAlgorithm: credential.algorithm },
    });
    return {
      outcome: "authenticated",
      identity: { user: account, sessionId: created.sessionId, needsRotation: false, authenticatedAt: created.authenticatedAt },
      token: created.token,
      absoluteExpiresAt: created.absoluteExpiresAt,
    };
  } catch {
    return { outcome: "unavailable" };
  }
}

function normalizedIdentifierKey(email: string): string {
  try { return normalizeEmail(email).normalizedEmail; } catch { return email.trim().normalize("NFC").toLowerCase().slice(0, 320) || "invalid-identifier"; }
}

async function verifyDummyPassword(passwords: PasswordService, password: string): Promise<void> {
  dummyHash ??= passwords.hash(dummyPassword);
  const hash = await dummyHash;
  await passwords.verify({ algorithm: "argon2id", algorithmParameters: { ...passwords.parameters }, passwordHash: hash }, password).catch(() => undefined);
}
