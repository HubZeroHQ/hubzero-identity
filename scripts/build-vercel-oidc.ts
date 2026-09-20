import { build } from "esbuild";

/**
 * Vercel's Node Function compiler preserves path aliases in helper modules.
 * Bundle the shared OIDC Node adapter beside its API wrappers so their static
 * CommonJS require is traced as a normal function-local dependency.
 */
await build({
  entryPoints: ["src/lib/oidc/vercel-adapter.ts"],
  outfile: "api/oidc/_adapter.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  // Keep the protocol/runtime graph self-contained. Dynamic createRequire in
  // the Vercel API shim is intentionally not traceable, so externalizing
  // pure-JS dependencies would omit zod, jose, oidc-provider, and MongoDB.
  // Native password modules remain external and are resolved from the
  // function's normal production dependencies.
  external: ["argon2", "bcrypt"],
  alias: { "@": "./src" },
  sourcemap: true,
});
