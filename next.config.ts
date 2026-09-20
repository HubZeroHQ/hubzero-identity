import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The tiny Vercel API wrappers load the build-time bundled Node adapter.
  // Include it in every OIDC function explicitly: dynamic createRequire calls
  // are intentionally not inferred by Next's output-file tracer.
  outputFileTracingIncludes: {
    "/api/oidc/**/*": ["./dist/vercel-oidc/**/*"],
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
