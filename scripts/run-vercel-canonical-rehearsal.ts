import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const rehearsalUri = process.env.REHEARSAL_MONGODB_URI;
if (!rehearsalUri || new URL(rehearsalUri).pathname.replace(/^\/+/, "") !== "hubzero_identity_rehearsal") {
  throw new Error("REHEARSAL_MONGODB_URI must explicitly target hubzero_identity_rehearsal");
}
const fixtureSuffix = randomBytes(9).toString("hex");

// These values exist only in this process and its children. The configurator
// sends the client secret to Vercel as a protected environment value and never
// writes any of them to disk or stdout.
const environment = {
  ...process.env,
  REHEARSAL_APP_ENV: "production",
  REHEARSAL_ISSUER_URL: "https://auth.hubzero.in",
  REHEARSAL_TEST_PASSWORD: randomBytes(32).toString("base64url"),
  REHEARSAL_CLIENT_SECRET: randomBytes(48).toString("base64url"),
  REHEARSAL_TEST_EMAIL: `vercel-${fixtureSuffix}@example.invalid`,
  REHEARSAL_IDEMPOTENCY_KEY: `phase-6b-vercel-rehearsal-${fixtureSuffix}`,
  REHEARSAL_CANONICAL_ISSUER: "true",
  VERCEL_REHEARSAL_URL: "https://auth.hubzero.in",
};

await run("npx", ["tsx", "scripts/configure-vercel-rehearsal.ts"], environment, "ignore");
const deployment = await run("npx", ["vercel", "--prod", "--yes", "--skip-domain", "--scope", "rifaques-projects"], environment, "capture");
if (deployment.exitCode !== 0) throw new Error("Vercel canonical rehearsal deployment failed");
const deploymentUrl = deployment.stdout.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
if (!deploymentUrl) throw new Error("Vercel did not return a deployment URL");
await run("npx", ["vercel", "alias", "set", deploymentUrl, "auth.hubzero.in", "--scope", "rifaques-projects"], environment, "ignore");
const verification = await run("npx", ["tsx", "scripts/verify-remote-oidc.ts"], environment, "capture");
if (verification.exitCode !== 0) throw new Error("Canonical deployed OIDC verification failed");

// verify-remote-oidc emits only its small sanitized result object.
process.stdout.write(`${verification.stdout.trim()}\n`);

type OutputMode = "ignore" | "capture";
function run(command: string, args: string[], env: NodeJS.ProcessEnv, output: OutputMode): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32", env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    // Commands here are intentionally configured not to write credentials. Do
    // not forward their output; failures are represented by a bounded message.
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout: output === "capture" ? stdout : "" }));
  });
}
