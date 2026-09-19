import bcrypt from "bcrypt";
import { describe, expect, it } from "vitest";
import { PasswordService, CredentialFormatError, currentArgon2idParameters, parseBcryptHash } from "./password";

describe("password service", () => {
  const service = PasswordService.create();

  it("hashes and verifies with the production Argon2id parameters", async () => {
    const hash = await service.hash("correct horse battery staple");
    const result = await service.verify({ algorithm: "argon2id", algorithmParameters: currentArgon2idParameters, passwordHash: hash }, "correct horse battery staple");
    expect(result).toEqual({ valid: true, needsRehash: false, algorithm: "argon2id" });
  });

  it("detects lower-parameter Argon2 hashes as needing rehash", async () => {
    const testService = PasswordService.createForTesting({ version: 19, memoryCostKiB: 4096, timeCost: 1, parallelism: 1, hashLength: 16 });
    const hash = await testService.hash("correct horse battery staple");
    await expect(service.verify({ algorithm: "argon2id", algorithmParameters: testService.parameters, passwordHash: hash }, "correct horse battery staple")).resolves.toMatchObject({ valid: true, needsRehash: true });
  });

  it("parses bcrypt metadata and refuses passwords beyond the legacy byte boundary", async () => {
    const hash = await bcrypt.hash("correct horse battery staple", 4);
    const parameters = parseBcryptHash(hash);
    await expect(service.verify({ algorithm: "bcrypt", algorithmParameters: parameters, passwordHash: hash }, "é".repeat(40))).resolves.toEqual({ valid: false, reason: "legacy_password_too_long" });
  });

  it("can upgrade a verified short legacy password without applying the new-password minimum", async () => {
    const hash = await service.hashLegacyPasswordForUpgrade("oldpass");
    await expect(service.verify({ algorithm: "argon2id", algorithmParameters: currentArgon2idParameters, passwordHash: hash }, "oldpass")).resolves.toMatchObject({ valid: true });
  });

  it("rejects malformed or inconsistent credential metadata", async () => {
    await expect(service.verify({ algorithm: "bcrypt", algorithmParameters: { version: "2b", cost: 12 }, passwordHash: "$2b$broken" }, "anything long enough")).rejects.toThrow(CredentialFormatError);
  });
});
