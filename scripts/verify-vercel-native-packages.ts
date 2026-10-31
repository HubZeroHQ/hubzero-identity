import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, openSync, closeSync, readFileSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertNativeBinary, formatNativeTarget, parseNativeTarget, vercelNativeTarget } from "./lib/native-binary";

const targetFlag = process.argv.indexOf("--target");
const target = targetFlag === -1 ? vercelNativeTarget : parseNativeTarget(process.argv[targetFlag + 1] ?? "");
const targetName = formatNativeTarget(target);
const functionsRoot = join(process.cwd(), ".vercel", "output", "functions");
const traceRoot = join(process.cwd(), ".next", "server", "app");
const credentialTraces = ["sign-in/page.js.nft.json", "change-password/page.js.nft.json", "security/page.js.nft.json"];
const expectedRuntimeFiles = ["node_modules/argon2/argon2.cjs", "node_modules/bcrypt/bcrypt.js", "node_modules/@phc/format/index.js", "node_modules/node-gyp-build/index.js"];
const nativePackages = ["argon2", "bcrypt"];

if (!existsSync(functionsRoot) || !existsSync(traceRoot)) throw new Error("Vercel output is missing; run `vercel build` before verifying native packages");

const windowsPathConfigs = walk(functionsRoot).filter((file) => file.endsWith(".vc-config.json") && /"[A-Za-z]:[\\/]|\\\\/.test(readFileSync(file, "utf8")));
if (windowsPathConfigs.length > 0) throw new Error(`Function config holds Windows paths and cannot run on ${targetName}: ${relative(functionsRoot, windowsPathConfigs[0]!)}`);

for (const route of credentialTraces) {
  const path = join(traceRoot, route);
  if (!existsSync(path)) throw new Error(`Missing credential route trace ${route}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { files?: unknown };
  if (!Array.isArray(parsed.files) || !parsed.files.every((file) => typeof file === "string")) throw new Error(`Invalid credential route trace ${route}`);
  const files = (parsed.files as string[]).map(normalize);
  for (const expected of expectedRuntimeFiles) {
    if (!files.some((file) => file.endsWith(expected))) throw new Error(`Missing native password runtime file ${expected} from ${route}`);
  }
  // Traces list every prebuild the packages ship; only the target's can load.
  const traced = files.filter((file) => file.endsWith(".node") && file.includes(`/prebuilds/${targetName}/`)).map((file) => resolve(dirname(path), file));
  assertNativeModules(traced, route);
}

const oidcFunctionRoutes = ["authorize.func", "discovery.func", "jwks.func", "token.func", "health/oidc.func", "health/ready.func"];
const missingOidcAdapters = oidcFunctionRoutes.filter((route) => !existsSync(join(functionsRoot, "api", "oidc", route, "api", "oidc", "_adapter.cjs")));
if (missingOidcAdapters.length > 0) throw new Error(`Missing OIDC adapter from function packages: ${missingOidcAdapters.join(", ")}`);
const oidcMetadataFunctionRoutes = oidcFunctionRoutes.filter((route) => route !== "health/ready.func");
const oidcFunctionsContainNativePasswordModules = oidcMetadataFunctionRoutes
  .some((route) => existsSync(join(functionsRoot, "api", "oidc", route, "node_modules", "argon2")));
if (oidcFunctionsContainNativePasswordModules) throw new Error("OIDC metadata/protocol functions still eagerly package Argon2");
const readinessRoot = join(functionsRoot, "api", "oidc", "health/ready.func");
for (const expected of expectedRuntimeFiles) {
  if (!existsSync(join(readinessRoot, expected))) throw new Error(`Missing readiness native password runtime file ${expected}`);
}
assertNativeModules(walk(join(readinessRoot, "node_modules")).filter((file) => file.endsWith(".node")), "health/ready.func");

const smokeTest = runSmokeTest(readinessRoot);

process.stdout.write(`${JSON.stringify({ target: targetName, credentialRouteTraces: credentialTraces, oidcFunctionRoutes, nativeBinaries: `ELF ${target.arch}`, nativePasswordRuntime: "present", oidcMetadataNativeCoupling: "absent", readinessNativePasswordRuntime: "present", smokeTest })}\n`);

/** Every packaged module must load on the target, and each package needs one. */
function assertNativeModules(files: string[], source: string) {
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`Traced native module is missing from ${source}: ${file}`);
    assertNativeBinary(file, readHeader(file), target);
  }
  for (const name of nativePackages) {
    const directory = `/node_modules/${name}/prebuilds/${targetName}/`;
    if (!files.some((file) => normalize(file).includes(directory))) throw new Error(`Missing ${name} native binding for ${targetName} from ${source}`);
  }
}

/** Loads the packaged modules, not the repository's, in a separate process. */
function runSmokeTest(root: string): string {
  const hostName = `${process.platform}-${process.arch}`;
  if (hostName !== targetName) throw new Error(`Cannot run the Argon2 and bcrypt smoke test for ${targetName} on ${hostName}; run this verifier on ${targetName}`);
  const script = `
    const { createRequire } = require("node:module");
    const { realpathSync } = require("node:fs");
    const { sep } = require("node:path");
    const root = realpathSync(process.argv[1]);
    const load = createRequire(root + sep + "smoke.cjs");
    for (const name of ["argon2", "bcrypt"]) {
      if (!realpathSync(load.resolve(name)).startsWith(root + sep)) throw new Error(name + " did not resolve from the function package");
    }
    (async () => {
      const argon2 = load("argon2");
      const bcrypt = load("bcrypt");
      const argonHash = await argon2.hash("smoke-test", { type: argon2.argon2id });
      if (!argonHash.startsWith("$argon2id$") || !(await argon2.verify(argonHash, "smoke-test")) || await argon2.verify(argonHash, "wrong")) throw new Error("Argon2id hash and verify failed");
      const bcryptHash = await bcrypt.hash("smoke-test", 4);
      if (!(await bcrypt.compare("smoke-test", bcryptHash)) || await bcrypt.compare("wrong", bcryptHash)) throw new Error("bcrypt hash and verify failed");
    })().catch((error) => { console.error(error.message); process.exit(1); });
  `;
  execFileSync(process.execPath, ["-e", script, realpathSync(root)], { cwd: dirname(root), stdio: ["ignore", "ignore", "inherit"], timeout: 60_000 });
  return "argon2id and bcrypt hash and verify passed";
}

function readHeader(file: string): Uint8Array {
  const buffer = new Uint8Array(4096);
  const descriptor = openSync(file, "r");
  try {
    return buffer.subarray(0, readSync(descriptor, buffer));
  } finally {
    closeSync(descriptor);
  }
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}${sep}${name}`;
    return lstatSync(path).isDirectory() ? walk(path) : [path];
  });
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/");
}
