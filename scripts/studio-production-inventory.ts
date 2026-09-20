import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { normalizeEmail } from "@/lib/identity/email";

const SOURCE_DATABASE = "hubzero";
const READ_ONLY_ROLES = new Set(["read"]);
const REFERENCE_PATHS = [
  ["work", "createdByUserId"], ["builds", "createdByUserId"], ["blueprints", "createdByUserId"],
  ["labs", "createdByUserId"], ["notes", "createdByUserId"], ["careers", "createdByUserId"],
  ["engineeringProfiles", "createdByUserId"], ["media", "createdByUserId"], ["documentVersions", "createdByUserId"],
  ["editorialEvents", "actorUserId"], ["notes", "authorId"], ["leads", "assignedToUserId"],
  ["careerInterests", "assignedToUserId"], ["team", "userId"],
] as const;

interface SourceUser {
  _id: ObjectId;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  disabled?: unknown;
  mustChangePassword?: unknown;
  passwordHash?: unknown;
  identitySubject?: unknown;
}

function bcryptMetadata(value: unknown) {
  if (typeof value !== "string") return { algorithm: "missing" as const };
  const match = /^\$(2[aby])\$(\d{2})\$/.exec(value);
  return match ? { algorithm: "bcrypt" as const, variant: match[1], cost: Number(match[2]) } : { algorithm: "unsupported" as const };
}

function normalize(value: unknown) {
  if (typeof value !== "string") return { valid: false as const };
  try {
    const result = normalizeEmail(value);
    return { valid: true as const, email: result.email, normalizedEmail: result.normalizedEmail, normalizationVersion: result.version };
  } catch {
    return { valid: false as const };
  }
}

function parseOutput(): string | undefined {
  return process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length) ?? process.env.npm_config_output;
}

function hasReadOnlyConfirmation(): boolean {
  return process.argv.includes("--confirm-read-only") || process.env.npm_config_confirm_read_only === "true";
}

async function main(): Promise<void> {
  if (!hasReadOnlyConfirmation()) {
    throw new Error("Refusing source access without --confirm-read-only");
  }
  const uri = process.env.STUDIO_INVENTORY_MONGODB_URI;
  if (!uri) throw new Error("STUDIO_INVENTORY_MONGODB_URI is required; MONGODB_URI is never used for Studio inventory");
  const parsed = new URL(uri);
  if (decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) !== SOURCE_DATABASE) {
    throw new Error("Studio inventory URI must explicitly target the hubzero database");
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
    const roles = status.authInfo?.authenticatedUserRoles ?? [];
    if (!roles.length || !roles.every((role: { role?: string; db?: string }) => role.db === SOURCE_DATABASE && READ_ONLY_ROLES.has(role.role ?? ""))) {
      throw new Error("Studio inventory requires a dedicated read-only role scoped to hubzero; refusing this credential");
    }

    const database = client.db(SOURCE_DATABASE);
    const users = await database.collection<SourceUser>("users").find({}, { projection: { email: 1, name: 1, role: 1, disabled: 1, mustChangePassword: 1, passwordHash: 1, identitySubject: 1 } }).toArray();
    const records = await Promise.all(users.map(async (user) => {
      const email = normalize(user.email);
      const references = Object.fromEntries(await Promise.all(REFERENCE_PATHS.map(async ([collection, field]) => [
        `${collection}.${field}`,
        await database.collection(collection).countDocuments({ [field]: user._id }),
      ])));
      return {
        studioUserId: user._id.toHexString(),
        name: typeof user.name === "string" ? user.name : undefined,
        email,
        role: typeof user.role === "string" ? user.role : "invalid",
        disabled: user.disabled === true,
        mustChangePassword: user.mustChangePassword === true,
        credential: bcryptMetadata(user.passwordHash),
        identitySubjectPresent: typeof user.identitySubject === "string",
        references,
      };
    }));
    const normalized = new Map<string, string[]>();
    for (const record of records) if (record.email.valid) normalized.set(record.email.normalizedEmail, [...(normalized.get(record.email.normalizedEmail) ?? []), record.studioUserId]);
    const collisions = [...normalized.entries()].filter(([, ids]) => ids.length > 1).map(([normalizedEmail, studioUserIds]) => ({ normalizedEmail, studioUserIds }));
    const manifest = {
      schemaVersion: 1,
      mode: "read-only-inventory",
      sourceDatabase: SOURCE_DATABASE,
      generatedAt: new Date().toISOString(),
      expectedAccountCount: 5,
      observedAccountCount: records.length,
      normalizationVersion: 1,
      collisions,
      records,
    };
    const output = parseOutput();
    if (output) {
      const destination = resolve(output);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify({ mode: manifest.mode, sourceDatabase: SOURCE_DATABASE, observedAccountCount: records.length, expectedAccountCount: 5, collisionCount: collisions.length, invalidEmailCount: records.filter((record) => !record.email.valid).length, credentialAlgorithms: records.reduce<Record<string, number>>((counts, record) => ({ ...counts, [record.credential.algorithm]: (counts[record.credential.algorithm] ?? 0) + 1 }), {}), outputWritten: Boolean(output) })}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Studio inventory failed"}\n`);
  process.exitCode = 1;
});
