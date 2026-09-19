import { ObjectId, type Db, type MongoClient } from "mongodb";
import { monotonicFactory } from "ulid";
import type { IdentitySubject } from "@/domain/identity";
import { identityCredentialsCollection } from "@/lib/db/collections";
import type { PasswordCredentialDocument } from "@/lib/db/documents";
import { withRequiredTransaction } from "@/lib/db/transaction";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";
import { PasswordService, parseBcryptHash } from "./password";

const createUlid = monotonicFactory();

export interface CredentialVerificationResult {
  valid: boolean;
  upgraded: boolean;
  reason?: "missing" | "mismatch" | "legacy_password_too_long";
}

export class CredentialService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private passwords: PasswordService,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {}

  async buildNewPasswordCredential(
    identitySubject: IdentitySubject,
    password: string,
    mustChangePassword: boolean,
  ): Promise<PasswordCredentialDocument> {
    const now = this.clock.now();
    return {
      _id: new ObjectId(),
      id: `cred_${createUlid(now.getTime())}`,
      identitySubject,
      type: "password",
      passwordHash: await this.passwords.hash(password),
      algorithm: "argon2id",
      algorithmParameters: { ...this.passwords.parameters },
      mustChangePassword,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async verifyAndUpgrade(identitySubject: IdentitySubject, password: string): Promise<CredentialVerificationResult> {
    const collection = identityCredentialsCollection(this.database);
    const credential = await collection.findOne({ identitySubject, type: "password" });
    if (!credential) return { valid: false, upgraded: false, reason: "missing" };
    const verification = await this.passwords.verify(credential, password);
    if (!verification.valid) return { valid: false, upgraded: false, reason: verification.reason };
    if (credential.algorithm !== "bcrypt") return { valid: true, upgraded: false };

    const replacementHash = await this.passwords.hashLegacyPasswordForUpgrade(password);
    const legacy = parseBcryptHash(credential.passwordHash);
    const upgraded = await withRequiredTransaction(this.client, async (session) => {
      const now = this.clock.now();
      const update = await collection.updateOne({
        _id: credential._id,
        algorithm: "bcrypt",
        passwordHash: credential.passwordHash,
      }, {
        $set: {
          passwordHash: replacementHash,
          algorithm: "argon2id",
          algorithmParameters: { ...this.passwords.parameters },
          updatedAt: now,
        },
      }, { session });
      if (update.modifiedCount === 0) return false;
      await this.events.append("password.legacy_migrated", {
        fromAlgorithm: "bcrypt",
        toAlgorithm: "argon2id",
        legacyCost: legacy.cost,
      }, { targetSubject: identitySubject }, session);
      return true;
    });

    if (upgraded) return { valid: true, upgraded: true };
    const winner = await collection.findOne({ _id: credential._id });
    if (!winner || winner.algorithm !== "argon2id") throw new Error("Credential upgrade race ended in an invalid state");
    const winnerVerification = await this.passwords.verify(winner, password);
    if (!winnerVerification.valid) throw new Error("Credential upgrade race produced an unverifiable credential");
    return { valid: true, upgraded: false };
  }
}
