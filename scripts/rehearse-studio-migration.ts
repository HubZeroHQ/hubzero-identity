import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildStudioMigrationDryRun, inspectStudioMigrationSource } from "../src/lib/migration/studio-rehearsal";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    memberships: { type: "string" },
    mode: { type: "string", default: "dry-run" },
  },
  strict: true,
});

// npm on Windows may consume `--input=value` as npm configuration instead of
// forwarding it to the script. Supporting its namespaced environment fallback
// keeps the documented `npm run … -- --input=…` form deterministic without
// loosening Node's strict argument parser.
const inputPath = values.input ?? process.env.npm_config_input;
const mode = values.mode ?? process.env.npm_config_mode ?? "dry-run";

if (!inputPath) throw new Error("Missing --input. This command accepts only an operator-provided, sanitized JSON export.");
if (mode !== "inventory" && mode !== "dry-run") throw new Error("--mode must be inventory or dry-run; this rehearsal command never mutates a database.");

const source = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
if (!Array.isArray(source)) throw new Error("Input must be a JSON array of Studio user records.");
const memberships = values.memberships
  ? JSON.parse(await readFile(values.memberships, "utf8")) as Record<string, readonly string[]>
  : {};

const result = mode === "inventory"
  ? { inventory: inspectStudioMigrationSource(source).inventory }
  : buildStudioMigrationDryRun(source, memberships);
process.stdout.write(`${JSON.stringify(result)}\n`);
