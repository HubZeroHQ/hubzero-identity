import "server-only";

import type { Environment } from "@/lib/env";

export function summarizeUserAgent(value: string | null): string | null {
  if (!value || value.length > 1_000) return null;
  const browser = /Edg\//.test(value) ? "Edge" : /Firefox\//.test(value) ? "Firefox" : /Chrome\//.test(value) ? "Chrome" : /Safari\//.test(value) ? "Safari" : null;
  const platform = /Windows/.test(value) ? "Windows" : /Android/.test(value) ? "Android" : /iPhone|iPad|iPod/.test(value) ? "iOS" : /Mac OS X/.test(value) ? "macOS" : /Linux/.test(value) ? "Linux" : null;
  return browser && platform ? `${browser} on ${platform}` : browser ?? platform ?? "Unknown browser";
}

export function trustedIpPrefix(forwardedFor: string | null, environment: Environment): string | null {
  if (!environment.TRUSTED_PROXIES || !forwardedFor) return null;
  const candidate = forwardedFor.split(",")[0]?.trim();
  if (!candidate || candidate.length > 64) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return candidate.split(".").slice(0, 3).join(".") + ".0/24";
  if (/^[0-9a-fA-F:]+$/.test(candidate)) return `${candidate.split(":").slice(0, 4).join(":")}::/64`;
  return null;
}

export function loginNetworkKey(ipPrefix: string | null): string {
  return ipPrefix ?? "unavailable-network";
}
