import { hmacSha256, randomBase64Url } from "@/lib/security/crypto";

const sessionIdPattern = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export interface ParsedSessionSecret {
  sessionId: string;
  secret: string;
}

export function createSessionSecret(sessionId: string): ParsedSessionSecret & { token: string } {
  const secret = randomBase64Url(32);
  return { sessionId, secret, token: `${sessionId}.${secret}` };
}

export function parseSessionToken(token: string): ParsedSessionSecret | null {
  const separator = token.indexOf(".");
  if (separator < 0 || token.indexOf(".", separator + 1) >= 0) return null;
  const sessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!sessionIdPattern.test(sessionId) || !secretPattern.test(secret)) return null;
  return { sessionId, secret };
}

export function hashSessionSecret(sessionId: string, secret: string, key: Uint8Array): string {
  return hmacSha256(secret, key, `hubzero-identity/session/v1/${sessionId}`);
}
