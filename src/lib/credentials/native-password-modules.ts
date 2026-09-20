import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as Argon2Module from "argon2";
import type BcryptModule from "bcrypt";

export interface NativePasswordModules {
  argon2: typeof Argon2Module;
  bcrypt: typeof BcryptModule;
}

let nativeModulesPromise: Promise<NativePasswordModules> | undefined;
// `process.cwd()` is the function root on Vercel and the repository root in
// local Node execution. Unlike `import.meta.url`, it also survives the CJS
// provider-adapter bundle used by the Vercel Functions.
const runtimeRequire = createRequire(resolve(process.cwd(), "package.json"));

/**
 * Native password packages must not become an import-time dependency of
 * discovery, JWKS, or other protocol metadata. They are loaded only by a
 * credential operation, while Next's output tracing explicitly packages their
 * small runtime closure for credential-owning functions.
 */
export function loadNativePasswordModules(): Promise<NativePasswordModules> {
  nativeModulesPromise ??= Promise.all([
    importRuntimeDependency("argon2") as Promise<typeof Argon2Module>,
    importRuntimeDependency("bcrypt") as Promise<typeof BcryptModule>,
  ]).then(([argon2, bcrypt]) => {
    const cjsBcrypt = bcrypt as typeof BcryptModule & { default?: typeof BcryptModule };
    return { argon2, bcrypt: cjsBcrypt.default ?? bcrypt };
  });
  return nativeModulesPromise;
}

// Keep the native module name opaque to the CJS adapter bundle. The adapter
// serves discovery/JWKS and must not cause Vercel to trace credentials merely
// because it constructs a PasswordService. Credential-owning Next functions
// explicitly trace the native closure in next.config.ts.
function importRuntimeDependency(name: string): Promise<unknown> {
  // Next cannot emit a variable `import()` in a server bundle. `createRequire`
  // keeps this native-only dependency lazy for shared metadata routes while
  // resolving it normally from the explicitly traced function package when a
  // credential operation actually needs it.
  return Promise.resolve(runtimeRequire(name));
}
