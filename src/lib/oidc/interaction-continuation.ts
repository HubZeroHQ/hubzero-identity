import type { Db } from "mongodb";
import { oidcInteractionContinuationsCollection } from "@/lib/db/collections";
import { hmacSha256, randomBase64Url } from "@/lib/security/crypto";

export const oidcContinuationCookieName = (environment: "production" | "development" | "test" | "preview") =>
  environment === "production" ? "__Host-hz_oidc_continue" : "hz_oidc_continue_dev";

export const oidcProviderSessionCookieName = (environment: "production" | "development" | "test" | "preview") =>
  environment === "production" ? "__Host-hz_oidc" : "hz_oidc_dev";

export class OidcInteractionContinuationService {
  constructor(private database: Db, private hmacKey: Uint8Array) {}

  async create(input: { interactionUid: string; clientId: string; expiresAt: Date }): Promise<string> {
    const token = randomBase64Url(32);
    await oidcInteractionContinuationsCollection(this.database).insertOne({
      _id: this.lookup(token), interactionUid: input.interactionUid, clientId: input.clientId,
      expiresAt: input.expiresAt, createdAt: new Date(),
    });
    return token;
  }

  async find(token: string | null | undefined, interactionUid?: string) {
    if (!token) return null;
    const continuation = await oidcInteractionContinuationsCollection(this.database).findOne({ _id: this.lookup(token) });
    if (!continuation || continuation.expiresAt <= new Date() || (interactionUid && continuation.interactionUid !== interactionUid)) return null;
    return continuation;
  }

  private lookup(token: string): string { return hmacSha256(token, this.hmacKey, "hubzero:oidc:interaction-continuation"); }
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      try { return decodeURIComponent(value); } catch { return null; }
    }
  }
  return null;
}
