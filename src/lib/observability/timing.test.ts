import { describe, expect, it } from "vitest";
import { mongoCommandTimer, timed, withRequestTiming } from "./timing";

describe("safe request timing", () => {
  it("isolates concurrent counters and reports only bounded metrics", async () => {
    const reports: unknown[] = [];
    await Promise.all([1, 2].map(count => withRequestTiming(async () => {
      await timed("prepare", async () => { for (let i = 0; i < count; i++) mongoCommandTimer()(); });
    }, value => reports.push(value))));
    expect(reports).toEqual(expect.arrayContaining([
      { phases: { prepare: expect.any(Number) }, mongoCount: 1, mongoMs: expect.any(Number) },
      { phases: { prepare: expect.any(Number) }, mongoCount: 2, mongoMs: expect.any(Number) },
    ]));
  });
  it("reports failures without capturing the thrown error", async () => {
    let report: unknown;
    await expect(withRequestTiming(() => timed("provider", async () => { throw new Error("sensitive"); }), value => { report = value; })).rejects.toThrow();
    expect(JSON.stringify(report)).not.toContain("sensitive");
  });
});
