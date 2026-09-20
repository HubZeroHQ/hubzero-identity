import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Native password bindings are deliberately external to Next's server
  // bundle. Output tracing then carries their exact runtime closure instead
  // of attempting to inline a platform-specific .node artifact.
  serverExternalPackages: ["argon2", "bcrypt"],
  outputFileTracingIncludes: {
    // Server Actions can perform Argon2id verification and legacy bcrypt
    // upgrade. Keep this narrow (the two native packages and their direct
    // runtime dependencies), but include it for every Next server function
    // because action endpoints are generated independently of page routes.
    "/*": [
      "./node_modules/argon2/**",
      "./node_modules/bcrypt/**",
      "./node_modules/@phc/format/**",
      "./node_modules/node-gyp-build/**",
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
