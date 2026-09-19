import { describe, expect, it } from "vitest";
import type { Environment } from "@/lib/env";
import { summarizeUserAgent, trustedIpPrefix } from "./request-metadata";

const trustedEnvironment = { TRUSTED_PROXIES: "10.0.0.0/8" } as Environment;
const untrustedEnvironment = { TRUSTED_PROXIES: undefined } as Environment;

describe("authentication request metadata", () => {
  it("derives conservative browser labels without retaining the raw user agent", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(summarizeUserAgent("unrecognizable")).toBe("Unknown browser");
  });

  it("uses forwarded addresses only behind an explicitly configured proxy boundary", () => {
    expect(trustedIpPrefix("203.0.113.99, 10.0.0.2", trustedEnvironment)).toBe("203.0.113.0/24");
    expect(trustedIpPrefix("203.0.113.99", untrustedEnvironment)).toBeNull();
  });
});
