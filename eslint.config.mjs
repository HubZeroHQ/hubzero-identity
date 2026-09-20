import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".vercel/**", "coverage/**", "dist/**", "api/oidc/_adapter.cjs", "api/oidc/_adapter.cjs.map", "next-env.d.ts"]),
]);
