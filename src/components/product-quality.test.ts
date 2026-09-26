import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staleInteractionHtml } from "@/lib/oidc/error-page";

describe("production product surfaces", () => {
  it("uses the canonical mark without drawing a replacement", () => {
    const source = readFileSync("src/components/brand.tsx", "utf8");
    expect(source).toContain("/brand/hubzero-logo-black.svg");
    expect(source).not.toContain("<i");
  });
  it("does not ship preview identity data or inert denial actions", () => {
    const shell = readFileSync("src/components/account-shell.tsx", "utf8");
    const denial = readFileSync("src/app/access-unavailable/page.tsx", "utf8");
    expect(shell).not.toMatch(/design preview|no live account data/i);
    expect(denial).not.toContain("aarav@");
    expect(denial).toContain('href="/applications"');
  });
  it("renders a static recovery action without internal state or scripts", () => {
    expect(staleInteractionHtml).toContain('href="https://hubzero.in/studio/login"');
    expect(staleInteractionHtml).not.toMatch(/<script|sessionId|interactionUid|token=/);
    expect(staleInteractionHtml.match(/<h1>/g)).toHaveLength(1);
  });
  it("describes Studio as a product instead of exposing client-registration copy", () => {
    const applications = readFileSync("src/app/applications/page.tsx", "utf8");
    expect(applications).toContain('application?.slug === "studio"');
    expect(applications).toContain("Your workspace for publishing and managing HubZero content.");
    expect(applications).toContain("<p>{description}</p>");
  });
});
