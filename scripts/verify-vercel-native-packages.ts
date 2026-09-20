import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const functionsRoot = join(process.cwd(), ".vercel", "output", "functions");
const traceRoot = join(process.cwd(), ".next", "server", "app");
const credentialTraces = ["sign-in/page.js.nft.json", "change-password/page.js.nft.json", "security/page.js.nft.json"];
const expectedRuntimeFiles = ["node_modules/argon2/argon2.cjs", "node_modules/bcrypt/bcrypt.js", "node_modules/@phc/format/index.js", "node_modules/node-gyp-build/index.js"];

if (!existsSync(functionsRoot) || !existsSync(traceRoot)) throw new Error("Vercel output is missing; run `vercel build` before verifying native packages");

const traces = credentialTraces.map((route) => {
  const path = join(traceRoot, route);
  if (!existsSync(path)) throw new Error(`Missing credential route trace ${route}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { files?: unknown };
  if (!Array.isArray(parsed.files) || !parsed.files.every((file) => typeof file === "string")) throw new Error(`Invalid credential route trace ${route}`);
  return { route, files: parsed.files as string[] };
});

for (const trace of traces) {
  for (const expected of expectedRuntimeFiles) {
    if (!trace.files.some((file) => normalize(file).endsWith(expected))) {
      throw new Error(`Missing native password runtime file ${expected} from ${trace.route}`);
    }
  }
  const bindingPath = `node_modules/argon2/prebuilds/${process.platform}-${process.arch}/`;
  if (!trace.files.some((file) => normalize(file).includes(bindingPath) && file.endsWith(".node"))) {
    throw new Error(`Missing Argon2 native binding for ${process.platform}-${process.arch} from ${trace.route}`);
  }
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
const readinessBindingDirectory = join(readinessRoot, "node_modules", "argon2", "prebuilds", `${process.platform}-${process.arch}`);
if (!existsSync(readinessBindingDirectory)) throw new Error("Missing readiness Argon2 native binding directory");

process.stdout.write(`${JSON.stringify({ credentialRouteTraces: credentialTraces, oidcFunctionRoutes, platform: `${process.platform}-${process.arch}`, nativePasswordRuntime: "present", oidcMetadataNativeCoupling: "absent", readinessNativePasswordRuntime: "present" })}\n`);

function normalize(value: string): string {
  return value.replaceAll("\\", "/");
}
