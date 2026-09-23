import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportJWK, generateKeyPair } from "jose";

const rehearsalUri = process.env.REHEARSAL_MONGODB_URI;
if (!rehearsalUri) throw new Error("REHEARSAL_MONGODB_URI is required; this command never falls back to MONGODB_URI");
if (new URL(rehearsalUri).pathname.replace(/^\/+/, "") !== "hubzero_identity_rehearsal") {
  throw new Error("REHEARSAL_MONGODB_URI must explicitly target hubzero_identity_rehearsal");
}
const applicationEnvironment = process.env.REHEARSAL_APP_ENV ?? "test";
const issuer = process.env.REHEARSAL_ISSUER_URL ?? "https://hubzero-identity.vercel.app";
const isGenericRehearsal = applicationEnvironment === "test" && issuer === "https://hubzero-identity.vercel.app";
const isCanonicalRehearsal = applicationEnvironment === "production" && issuer === "https://auth.hubzero.in";
if (!isGenericRehearsal && !isCanonicalRehearsal) {
  throw new Error("Rehearsal deployment must be either the explicit test issuer or the explicit canonical issuer");
}

const signingKey = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
Object.assign(signingKey, { kid: "phase-6b-rehearsal-a", alg: "ES256", use: "sig" });

const password = process.env.REHEARSAL_TEST_PASSWORD ?? randomBytes(32).toString("base64url");
const clientSecret = process.env.REHEARSAL_CLIENT_SECRET ?? randomBytes(48).toString("base64url");
if (password.length < 16 || clientSecret.length < 32) throw new Error("Supplied rehearsal credential material is too short");

const deploymentEnvironment = {
  APP_ENV: applicationEnvironment,
  IDENTITY_ISSUER_URL: issuer,
  MONGODB_URI: rehearsalUri,
  OIDC_PROVIDER_ENABLED: "true",
  SESSION_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  RATE_LIMIT_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  OIDC_ADAPTER_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  OIDC_SIGNING_KEYSET_JSON: JSON.stringify({ keys: [signingKey] }),
  OIDC_SIGNING_ACTIVE_KID: "phase-6b-rehearsal-a",
  OIDC_CLIENT_SECRETS_JSON: JSON.stringify({ "studio-rehearsal": clientSecret }),
};

// Vercel serializes project-environment mutations. Keeping these writes
// ordered avoids a partially accepted rehearsal configuration when the
// platform rejects simultaneous replace requests.
for (const [name, value] of Object.entries(deploymentEnvironment)) {
  const outcome = await run("npx", ["vercel", "env", "add", name, "production", "--sensitive", "--force", "--yes", "--scope", "rifaques-projects"], value);
  if (outcome.exitCode !== 0) throw new Error(`Vercel rejected rehearsal configuration ${name}`);
}

const setup = await run("npx", ["tsx", "scripts/setup-vercel-rehearsal.ts"], undefined, {
  ...process.env,
  ...deploymentEnvironment,
  // Fixture provisioning is permanently test-only even when the deployed
  // runtime is temporarily exercising the canonical hostname against the
  // isolated rehearsal database.
  APP_ENV: "test",
  IDENTITY_ISSUER_URL: "https://hubzero-identity.vercel.app",
  REHEARSAL_TEST_PASSWORD: password,
  REHEARSAL_TEST_EMAIL: process.env.REHEARSAL_TEST_EMAIL ?? "vercel-rehearsal@example.invalid",
  REHEARSAL_IDEMPOTENCY_KEY: process.env.REHEARSAL_IDEMPOTENCY_KEY ?? "phase-6b-vercel-rehearsal-user-0001",
  REHEARSAL_STUDIO_CALLBACK_URL: "http://127.0.0.1:4100/studio/oidc/callback",
});
if (setup.exitCode !== 0) throw new Error("Unable to provision the isolated rehearsal identity");
const setupRecord = parseSetupRecord(setup.stdout);
const safeSubjectOutputPath = process.env.REHEARSAL_SUBJECT_OUTPUT_PATH;
if (safeSubjectOutputPath) {
  const resolvedOutput = resolve(safeSubjectOutputPath);
  const resolvedTemp = resolve(process.env.TEMP ?? process.env.TMP ?? "");
  if (!resolvedTemp || !resolvedOutput.startsWith(`${resolvedTemp}\\`)) {
    throw new Error("REHEARSAL_SUBJECT_OUTPUT_PATH must be an absolute path beneath the local temporary directory");
  }
  await writeFile(resolvedOutput, JSON.stringify({ syntheticAccounts: setupRecord.syntheticAccounts }), { encoding: "utf8", mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ configured: Object.keys(deploymentEnvironment), targetDatabase: "hubzero_identity_rehearsal", syntheticAccounts: setupRecord.syntheticAccounts })}\n`);

function run(command: string, args: string[], input?: string, environment?: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32", env: environment, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout }));
    child.stdin.end(input);
  });
}

function parseSetupRecord(output: string): { syntheticAccounts: Array<{ kind: string; subject: string }> } {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("{"));
  if (!line) throw new Error("Synthetic rehearsal setup did not return its safe subject metadata");
  const parsed = JSON.parse(line) as { syntheticAccounts?: unknown };
  if (!Array.isArray(parsed.syntheticAccounts) || !parsed.syntheticAccounts.every((entry) => typeof entry === "object" && entry !== null && typeof (entry as { kind?: unknown }).kind === "string" && typeof (entry as { subject?: unknown }).subject === "string")) {
    throw new Error("Synthetic rehearsal setup returned malformed subject metadata");
  }
  return { syntheticAccounts: parsed.syntheticAccounts as Array<{ kind: string; subject: string }> };
}
