import type { Argon2idParameters, BcryptParameters, PasswordCredential } from "@/domain/credentials";
import { passwordUtf8Length, validatePasswordLength } from "@/domain/credentials";
import { loadNativePasswordModules, type NativePasswordModules } from "./native-password-modules";

export const currentArgon2idParameters: Readonly<Argon2idParameters> = {
  version: 19,
  memoryCostKiB: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

const BCRYPT_MAX_BYTES = 72;
const bcryptHashPattern = /^\$(2a|2b)\$(\d{2})\$[./A-Za-z0-9]{53}$/;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export class CredentialFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialFormatError";
  }
}

export type PasswordVerification =
  | { valid: false; reason: "mismatch" | "legacy_password_too_long" }
  | { valid: true; needsRehash: boolean; algorithm: "argon2id" | "bcrypt" };

export class PasswordService {
  private constructor(
    readonly parameters: Readonly<Argon2idParameters>,
    private readonly loadNativeModules: () => Promise<NativePasswordModules> = loadNativePasswordModules,
  ) {}

  static create(): PasswordService {
    return new PasswordService(currentArgon2idParameters);
  }

  static createForTesting(parameters: Readonly<Argon2idParameters>, loadNativeModules?: () => Promise<NativePasswordModules>): PasswordService {
    if (process.env.NODE_ENV !== "test") throw new Error("Unsafe password parameters are available only in tests");
    return new PasswordService(parameters, loadNativeModules);
  }

  validateNewPassword(password: string): void {
    const error = validatePasswordLength(password);
    if (error) throw new PasswordPolicyError(error);
  }

  /**
   * Readiness verifies that the native verifier can be resolved without
   * spending Argon2 work on every health request. Credential operations still
   * perform real hash/verification work through the same loader.
   */
  async assertRuntimeAvailable(): Promise<void> {
    await this.loadNativeModules();
  }

  async hash(password: string): Promise<string> {
    this.validateNewPassword(password);
    return this.hashWithoutPolicy(password);
  }

  async hashLegacyPasswordForUpgrade(password: string): Promise<string> {
    if (passwordUtf8Length(password) > BCRYPT_MAX_BYTES) throw new PasswordPolicyError("Legacy bcrypt password exceeds 72 UTF-8 bytes");
    return this.hashWithoutPolicy(password);
  }

  private async hashWithoutPolicy(password: string): Promise<string> {
    const { argon2 } = await this.loadNativeModules();
    return argon2.hash(password, {
      type: argon2.argon2id,
      version: this.parameters.version,
      memoryCost: this.parameters.memoryCostKiB,
      timeCost: this.parameters.timeCost,
      parallelism: this.parameters.parallelism,
      hashLength: this.parameters.hashLength,
    });
  }

  async verify(credential: Pick<PasswordCredential, "algorithm" | "algorithmParameters" | "passwordHash">, password: string): Promise<PasswordVerification> {
    if (credential.algorithm === "argon2id") {
      if (passwordUtf8Length(password) > 1024) return { valid: false, reason: "mismatch" };
      if (!credential.passwordHash.startsWith("$argon2id$")) throw new CredentialFormatError("Malformed Argon2id credential");
      try {
        const { argon2 } = await this.loadNativeModules();
        const valid = await argon2.verify(credential.passwordHash, password);
        return valid
          ? { valid: true, needsRehash: argon2.needsRehash(credential.passwordHash, {
              version: this.parameters.version,
              memoryCost: this.parameters.memoryCostKiB,
              timeCost: this.parameters.timeCost,
              parallelism: this.parameters.parallelism,
            }), algorithm: "argon2id" }
          : { valid: false, reason: "mismatch" };
      } catch {
        throw new CredentialFormatError("Unable to verify Argon2id credential");
      }
    }

    if (credential.algorithm === "bcrypt") {
      const parsed = parseBcryptHash(credential.passwordHash);
      const metadata = credential.algorithmParameters as Partial<BcryptParameters>;
      if (metadata.cost !== parsed.cost || metadata.version !== parsed.version) {
        throw new CredentialFormatError("Bcrypt metadata does not match encoded hash");
      }
      if (passwordUtf8Length(password) > BCRYPT_MAX_BYTES) {
        return { valid: false, reason: "legacy_password_too_long" };
      }
      const { bcrypt } = await this.loadNativeModules();
      const valid = await bcrypt.compare(password, credential.passwordHash);
      return valid ? { valid: true, needsRehash: true, algorithm: "bcrypt" } : { valid: false, reason: "mismatch" };
    }

    throw new CredentialFormatError("Unsupported password algorithm");
  }
}

export function parseBcryptHash(hash: string): BcryptParameters {
  const match = bcryptHashPattern.exec(hash);
  if (!match) throw new CredentialFormatError("Malformed or unsupported bcrypt hash");
  const cost = Number(match[2]);
  if (cost < 4 || cost > 31) throw new CredentialFormatError("Unsupported bcrypt cost");
  return { version: match[1] as "2a" | "2b", cost };
}
