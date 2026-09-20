import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildStudioMigrationManifest } from "@/lib/migration/studio-manifest";

const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" } }, strict: true });
if (!values.input || !values.output) throw new Error("Both --input and --output are required; this command accepts only a hash-free inventory export.");

const inventory = JSON.parse(await readFile(values.input, "utf8")) as unknown;
const manifest = buildStudioMigrationManifest(inventory);
const destination = resolve(values.output);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ sourceDatabase: manifest.sourceDatabase, ...manifest.summary })}\n`);
