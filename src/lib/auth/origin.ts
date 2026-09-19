import "server-only";

import type { Environment } from "@/lib/env";

export class InvalidMutationOriginError extends Error {
  constructor() {
    super("The request did not originate from this HubZero Account deployment");
    this.name = "InvalidMutationOriginError";
  }
}

export function assertTrustedMutationOrigin(origin: string | null, environment: Environment): void {
  if (!origin || origin !== new URL(environment.IDENTITY_ISSUER_URL).origin) throw new InvalidMutationOriginError();
}

export function safeReturnPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  try {
    const destination = new URL(value, "https://auth.hubzero.in");
    return destination.origin === "https://auth.hubzero.in" ? `${destination.pathname}${destination.search}${destination.hash}` : fallback;
  } catch {
    return fallback;
  }
}
