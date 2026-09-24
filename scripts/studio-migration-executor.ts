import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import type { ApplicationId } from "../src/domain/applications";
import { StudioMigrationExecutor, StudioMigrationGateError } from "../src/lib/migration/studio-executor";

const commands: readonly string[] = ["plan", "apply", "status", "reconcile", "resume"];

function requiredUri(name: string, database: string): string {
  const uri = process.env[name];
  if (!uri) throw new StudioMigrationGateError(`${name} is required; no runtime MONGODB_URI fallback exists`);
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new StudioMigrationGateError(`${name} is not a valid MongoDB URI`); }
  if (decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) !== database) {
    throw new StudioMigrationGateError(`${name} must explicitly target ${database}`);
  }
  return uri;
}

async function assertScopedRole(client: MongoClient, role: "read" | "readWrite", database: string): Promise<void> {
  const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
  const roles: unknown[] = status.authInfo?.authenticatedUserRoles ?? [];
  if (roles.length !== 1 || roles[0] === null || typeof roles[0] !== "object"
    || (roles[0] as { role?: unknown }).role !== role || (roles[0] as { db?: unknown }).db !== database) {
    throw new StudioMigrationGateError(`Credential must have exactly ${role}@${database}, with no broad or write-capable extra role`);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      environment: { type: "string" },
      "confirm-production": { type: "boolean" },
      "confirm-rehearsal": { type: "boolean" },
      "expected-account-count": { type: "string" },
      "backup-reference": { type: "string" },
      "run-id": { type: "string" },
      "interrupt-after": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const [command] = positionals;
  if (!command || !commands.includes(command) || positionals.length !== 1) throw new StudioMigrationGateError("Expected one command: plan, apply, status, reconcile, or resume");
  const mode = values.environment;
  if (mode !== "production" && mode !== "rehearsal") throw new StudioMigrationGateError("--environment must be production or rehearsal");
  if (values["expected-account-count"] !== "5") throw new StudioMigrationGateError("--expected-account-count 5 is mandatory");
  const runId = values["run-id"];
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{5,79}$/.test(runId)) throw new StudioMigrationGateError("A stable, non-secret --run-id is required");
  const writes = command === "apply" || command === "resume" || command === "reconcile";
  if (mode === "production") {
    if (!values["confirm-production"] || values["confirm-rehearsal"]) throw new StudioMigrationGateError("Explicit --confirm-production is required");
    if (values["interrupt-after"]) throw new StudioMigrationGateError("Interruption injection is forbidden in production");
    if (writes && (!values["backup-reference"] || values["backup-reference"].length < 8)) {
      throw new StudioMigrationGateError("Production mutation requires an operator-verified --backup-reference; this tool cannot certify Atlas recovery");
    }
  } else if (!values["confirm-rehearsal"] || values["confirm-production"] || values["backup-reference"]) {
    throw new StudioMigrationGateError("Explicit isolated --confirm-rehearsal is required");
  }
  const interruptAfter = values["interrupt-after"];
  if (interruptAfter && (mode !== "rehearsal" || command !== "apply" || !["identity_imported", "studio_mapped"].includes(interruptAfter))) {
    throw new StudioMigrationGateError("Invalid rehearsal interruption point");
  }

  const sourceDatabase = mode === "production" ? "hubzero" : "hubzero_studio_rehearsal";
  const targetDatabase = mode === "production" ? "hubzero_identity" : "hubzero_identity_rehearsal";
  const sourceRole = mode === "production" && !writes ? "read" : "readWrite";
  const sourceVariable = mode === "production"
    ? (writes ? "STUDIO_MIGRATION_MONGODB_URI" : "STUDIO_INVENTORY_MONGODB_URI")
    : "STUDIO_REHEARSAL_MONGODB_URI";
  const targetVariable = mode === "production" ? "IDENTITY_MIGRATION_MONGODB_URI" : "REHEARSAL_MONGODB_URI";
  // Validate both URI database targets before connecting to either cluster.
  const sourceUri = requiredUri(sourceVariable, sourceDatabase);
  const targetUri = requiredUri(targetVariable, targetDatabase);
  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10_000 });
  const targetClient = new MongoClient(targetUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await sourceClient.connect();
    await targetClient.connect();
    await assertScopedRole(sourceClient, sourceRole, sourceDatabase);
    await assertScopedRole(targetClient, "readWrite", targetDatabase);
    const fixture = mode === "rehearsal"
      ? JSON.parse(await readFile(resolve(process.cwd(), "test/fixtures/studio-migration-production-shape.json"), "utf8")) as { accounts: Array<{ studioUserId: string }> }
      : null;
    const sourceIds = fixture?.accounts.map((account) => account.studioUserId);
    if (sourceIds && (sourceIds.length !== 5 || sourceIds.some((id) => !/^[0-9a-f]{24}$/i.test(id)))) {
      throw new StudioMigrationGateError("Rehearsal fixture must select exactly five synthetic ObjectIds");
    }
    const executor = new StudioMigrationExecutor({
      source: sourceClient.db(sourceDatabase), target: targetClient.db(targetDatabase), targetClient,
      applicationId: (mode === "production" ? "studio" : "studio-rehearsal") as ApplicationId,
      runId, expectedAccountCount: 5, rehearsalSourceIds: sourceIds,
    });
    const preflight = { environment: mode, sourceDatabase, sourceRole: `${sourceRole}@${sourceDatabase}`,
      targetDatabase, targetRole: `readWrite@${targetDatabase}`, runtimeMongoUriFallback: false,
      selectedSourceSubset: mode === "rehearsal" };
    let result: unknown;
    if (command === "plan") result = await executor.plan();
    if (command === "status") result = await executor.status();
    if (command === "apply") result = await executor.apply(false, interruptAfter as "identity_imported" | "studio_mapped" | undefined);
    if (command === "resume") result = await executor.apply(true);
    if (command === "reconcile") result = await executor.reconcile();
    process.stdout.write(`${JSON.stringify({ command, preflight, result })}\n`);
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main().catch((error: unknown) => {
  // Never print arbitrary driver/Zod exceptions: they may contain connection strings or source fields.
  process.stderr.write(`${error instanceof StudioMigrationGateError ? error.message : "Migration command failed; inspect sanitized operational diagnostics"}\n`);
  process.exitCode = 1;
});
