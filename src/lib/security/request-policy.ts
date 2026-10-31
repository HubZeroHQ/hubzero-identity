type RequestEnvironment = Record<string, string | undefined>;

/** Local runs keep any host; every deployed environment names exactly one. */
function isLocalEnvironment(environment: RequestEnvironment): boolean {
  if (environment.VERCEL_ENV) return environment.VERCEL_ENV === "development";
  return environment.APP_ENV === "development" || environment.APP_ENV === "test";
}

/**
 * A preview has no issuer of its own, so it is the one place `VERCEL_URL` is
 * read: the platform sets it to that deployment's exact hostname.
 */
function expectedOrigin(environment: RequestEnvironment): string | null {
  if (environment.VERCEL_ENV === "preview") return environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : null;
  return environment.IDENTITY_ISSUER_URL ?? null;
}

function normalizeHost(value: string, protocol: string): string | null {
  if (!/^[a-z0-9.:[\]-]+$/i.test(value)) return null;
  try {
    return new URL(`${protocol}//${value}`).host.replace(/\.(?=$|:)/, "");
  } catch {
    return null;
  }
}

/** Compares the request `Host` only. Forwarded headers are caller-controlled. */
export function isAcceptedHost(host: string | null, environment: RequestEnvironment): boolean {
  if (isLocalEnvironment(environment)) return true;
  const origin = expectedOrigin(environment);
  if (!origin || !host) return false;
  try {
    const expected = new URL(origin);
    return normalizeHost(host, expected.protocol) === expected.host;
  } catch {
    return false;
  }
}

export function contentSecurityPolicy(nonce: string, environment: RequestEnvironment, development: boolean): string {
  const upgrade = !development && !isLocalEnvironment(environment);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgrade ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
