import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { exportJWK, generateKeyPair } from "jose";

const rehearsalUri = process.env.REHEARSAL_MONGODB_URI;
if (!rehearsalUri) throw new Error("REHEARSAL_MONGODB_URI is required; this command never falls back to MONGODB_URI");
if (new URL(rehearsalUri).pathname.replace(/^\/+/, "") !== "hubzero_identity_rehearsal") {
  throw new Error("REHEARSAL_MONGODB_URI must explicitly target hubzero_identity_rehearsal");
}

const signingKey = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
Object.assign(signingKey, { kid: "phase-6b-rehearsal-a", alg: "ES256", use: "sig" });

const deploymentEnvironment = {
  APP_ENV: "test",
  IDENTITY_ISSUER_URL: "https://hubzero-identity.vercel.app",
  MONGODB_URI: rehearsalUri,
  OIDC_PROVIDER_ENABLED: "true",
  SESSION_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  RATE_LIMIT_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  OIDC_ADAPTER_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  OIDC_SIGNING_KEYSET_JSON: JSON.stringify({ keys: [signingKey] }),
  OIDC_SIGNING_ACTIVE_KID: "phase-6b-rehearsal-a",
  OIDC_CLIENT_SECRETS_JSON: JSON.stringify({ "studio-rehearsal": randomBytes(48).toString("base64url") }),
};
const password = randomBytes(32).toString("base64url");

await Promise.all(Object.entries(deploymentEnvironment).map(async ([name, value]) => {
  const outcome = await run("npx", ["vercel", "env", "add", name, "production", "--sensitive", "--force", "--yes", "--scope", "rifaques-projects"], value);
  if (outcome.exitCode !== 0) throw new Error(`Vercel rejected rehearsal configuration ${name}`);
}));

const setup = await run("npx", ["tsx", "scripts/setup-vercel-rehearsal.ts"], undefined, {
  ...process.env,
  ...deploymentEnvironment,
  REHEARSAL_TEST_PASSWORD: password,
  REHEARSAL_IDEMPOTENCY_KEY: "phase-6b-vercel-rehearsal-user-0001",
});
if (setup.exitCode !== 0) throw new Error("Unable to provision the isolated rehearsal identity");

process.stdout.write(`${JSON.stringify({ configured: Object.keys(deploymentEnvironment), targetDatabase: "hubzero_identity_rehearsal", syntheticIdentityProvisioned: true })}\n`);

function run(command: string, args: string[], input?: string, environment?: NodeJS.ProcessEnv): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32", env: environment, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode }));
    child.stdin.end(input);
  });
}
