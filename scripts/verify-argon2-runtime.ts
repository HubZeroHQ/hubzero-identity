import { randomBytes } from "node:crypto";
import { PasswordService, currentArgon2idParameters } from "@/lib/credentials/password";

const password = randomBytes(32).toString("base64url");
const service = PasswordService.create();
const hash = await service.hash(password);
const verified = await service.verify({ algorithm: "argon2id", algorithmParameters: currentArgon2idParameters, passwordHash: hash }, password);

if (!verified.valid || verified.algorithm !== "argon2id") throw new Error("Argon2id native hash verification failed");
process.stdout.write('{"argon2Runtime":"hash-and-verify-passed"}\n');
