import { errors, type Adapter, type AdapterPayload } from "oidc-provider";
import type { Db } from "mongodb";
import { oidcProviderArtifactsCollection } from "@/lib/db/collections";
import { hmacSha256 } from "@/lib/security/crypto";

const grantable = new Set(["AccessToken", "AuthorizationCode"]);

/**
 * A persistent, provider-owned Mongo adapter. Artifact selectors are HMAC-derived,
 * so a database read does not disclose an authorization code or opaque token.
 */
export class MongoOidcAdapter implements Adapter {
  constructor(private model: string, private database: Db, private lookupKey: Uint8Array) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const now = new Date();
    const expiresAt = typeof expiresIn === "number" ? new Date(now.getTime() + expiresIn * 1000) : null;
    const encoded = { ...payload } as Record<string, unknown>;
    await oidcProviderArtifactsCollection(this.database, this.model).updateOne(
      { _id: this.idLookup(id) },
      { $set: {
        model: this.model,
        payload: encoded,
        expiresAt,
        consumedAt: payload.consumed ? new Date() : null,
        uidLookup: typeof payload.uid === "string" ? this.secondaryLookup("uid", payload.uid) : null,
        userCodeLookup: typeof payload.userCode === "string" ? this.secondaryLookup("user_code", payload.userCode) : null,
        grantLookup: grantable.has(this.model) && typeof payload.grantId === "string" ? this.secondaryLookup("grant", payload.grantId) : null,
      } },
      { upsert: true },
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    return this.read({ _id: this.idLookup(id) });
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.read({ uidLookup: this.secondaryLookup("uid", uid) });
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.read({ userCodeLookup: this.secondaryLookup("user_code", userCode) });
  }

  async consume(id: string): Promise<void> {
    const result = await oidcProviderArtifactsCollection(this.database, this.model).updateOne(
      { _id: this.idLookup(id), consumedAt: null },
      { $set: { consumedAt: new Date(), "payload.consumed": Math.floor(Date.now() / 1000) } },
    );
    // The provider has already checked sequential reuse. A concurrent loser fails
    // before token issuance instead of silently consuming the same code twice.
    if (result.matchedCount !== 1) throw new errors.InvalidGrant("OIDC artifact was already consumed");
  }

  async destroy(id: string): Promise<void> {
    await oidcProviderArtifactsCollection(this.database, this.model).deleteOne({ _id: this.idLookup(id) });
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    if (!grantable.has(this.model)) return;
    await oidcProviderArtifactsCollection(this.database, this.model).deleteMany({ grantLookup: this.secondaryLookup("grant", grantId) });
  }

  private async read(query: Record<string, string>): Promise<AdapterPayload | undefined> {
    const document = await oidcProviderArtifactsCollection(this.database, this.model).findOne(query);
    if (!document || (document.expiresAt && document.expiresAt <= new Date())) return undefined;
    return { ...document.payload, ...(document.consumedAt ? { consumed: Math.floor(document.consumedAt.getTime() / 1000) } : {}) } as AdapterPayload;
  }

  private idLookup(id: string): string { return this.secondaryLookup(`artifact:${this.model}`, id); }
  private secondaryLookup(domain: string, value: string): string { return hmacSha256(value, this.lookupKey, `hubzero:oidc:${domain}`); }
}

export function createMongoOidcAdapter(database: Db, lookupKey: Uint8Array) {
  return (model: string) => new MongoOidcAdapter(model, database, lookupKey);
}
