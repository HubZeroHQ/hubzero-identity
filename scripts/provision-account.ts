import { parseArgs } from "node:util";
import { parseEnvironment } from "../src/lib/env";
import { getIdentityDatabaseConnection } from "../src/lib/db/mongodb";
import { planIdentityIndexes } from "../src/lib/db/indexes";
import { PasswordService } from "../src/lib/credentials/password";
import { CredentialService } from "../src/lib/credentials/service";
import { ProvisioningService } from "../src/lib/identity/provisioning";
import { MongoSecurityEventWriter } from "../src/lib/security/events";
import { normalizeEmail } from "../src/lib/identity/email";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    "actor-subject": { type: "string" },
    reason: { type: "string" },
    "idempotency-key": { type: "string" },
    membership: { type: "string", multiple: true, default: [] },
    "must-change-password": { type: "boolean", default: true },
    "password-stdin": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

for (const required of ["name", "email", "actor-subject", "reason", "idempotency-key"] as const) {
  if (!values[required]) throw new Error(`Missing required --${required}`);
}
if (!values["password-stdin"]) throw new Error("Initial password must be supplied through --password-stdin; password arguments are not supported");

const password = await readPasswordFromStdin();
const passwordService = PasswordService.create();
passwordService.validateNewPassword(password);

if (values["dry-run"]) {
  const result = { valid: true, email: normalizeEmail(values.email!).email, memberships: values.membership, message: "Dry run only; no account or credential was written" };
  process.stdout.write(values.json ? `${JSON.stringify(result)}\n` : `Provisioning input is valid\nEmail: ${result.email}\nMemberships: ${result.memberships?.join(", ") || "none"}\nNo data was written.\n`);
  process.exit(0);
}

const environment = parseEnvironment(process.env);
const { client, database } = await getIdentityDatabaseConnection(environment);
try {
  const indexPlan = await planIdentityIndexes(database);
  if (indexPlan.create.length > 0) throw new Error(`Database is missing ${indexPlan.create.length} required indexes; run npm run db:indexes first`);
  const events = new MongoSecurityEventWriter(database);
  const credentials = new CredentialService(database, client, passwordService, events);
  const provisioning = new ProvisioningService(database, client, credentials, events);
  const result = await provisioning.provision({
    name: values.name!,
    email: values.email!,
    password,
    accountType: "internal",
    mustChangePassword: values["must-change-password"],
    applicationIds: values.membership,
    idempotencyKey: values["idempotency-key"]!,
    actorSubject: values["actor-subject"]!,
    reason: values.reason!,
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ created: result.created, subject: result.subject, email: result.email, memberships: result.applicationIds })}\n`);
  } else {
    process.stdout.write(`${result.created ? "Provisioned" : "Found existing compatible"} HubZero Account\nSubject: ${result.subject}\nEmail: ${result.email}\nMemberships: ${result.applicationIds.join(", ") || "none"}\n`);
  }
} finally {
  await client.close();
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Refusing visible password input. Pipe or redirect the password to stdin from a protected secret source");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 4096) throw new Error("Password input exceeds the safe CLI limit");
    chunks.push(buffer);
  }
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!value) throw new Error("No password was received on stdin");
  return value;
}
