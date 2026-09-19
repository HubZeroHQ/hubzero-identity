import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./origin";

describe("safeReturnPath", () => {
  it("accepts a local relative account destination", () => {
    expect(safeReturnPath("/sessions?notice=updated")).toBe("/sessions?notice=updated");
  });

  it("rejects external, scheme-relative, malformed, and backslash destinations", () => {
    expect(safeReturnPath("https://example.invalid")).toBe("/");
    expect(safeReturnPath("//example.invalid")).toBe("/");
    expect(safeReturnPath("/\\example.invalid")).toBe("/");
    expect(safeReturnPath("\n/sessions")).toBe("/");
  });
});
