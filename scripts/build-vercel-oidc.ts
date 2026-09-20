import { build } from "esbuild";

/**
 * Vercel's legacy Node Function compiler preserves path aliases in helper
 * modules. Bundle the shared OIDC Node adapter first so each tiny API entry
 * has one portable CommonJS dependency with no repository-local imports.
 */
await build({
  entryPoints: ["src/lib/oidc/vercel-adapter.ts"],
  outfile: "dist/vercel-oidc/adapter.cjs",
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
