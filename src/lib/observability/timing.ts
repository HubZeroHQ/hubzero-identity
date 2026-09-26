import { AsyncLocalStorage } from "node:async_hooks";

interface RequestTiming { phases: Record<string, number>; mongoCount: number; mongoMs: number; }
const current = new AsyncLocalStorage<RequestTiming>();

export function safeServerTiming(): string {
  const timing = current.getStore();
  if (!timing) return "";
  return [...Object.entries(timing.phases).map(([name, duration]) => `${name};dur=${duration}`), `mongo;dur=${timing.mongoMs}`, `mongo_ops;desc="${timing.mongoCount}"`].join(", ");
}

/** Bounded names and numbers only. Never accepts URLs, queries or database documents. */
export function withRequestTiming<T>(run: () => Promise<T>, report: (timing: RequestTiming) => void): Promise<T> {
  const timing: RequestTiming = { phases: {}, mongoCount: 0, mongoMs: 0 };
  return current.run(timing, async () => { try { return await run(); } finally { report(timing); } });
}

export async function timed<T>(phase: "provider" | "prepare" | "interaction" | "protocol" | "mongoConnect", run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await run(); } finally {
    const timing = current.getStore();
    if (timing) timing.phases[phase] = Math.round((timing.phases[phase] ?? 0) + performance.now() - start);
  }
}

export function mongoCommandTimer() {
  const timing = current.getStore();
  const start = performance.now();
  return () => { if (timing) { timing.mongoCount += 1; timing.mongoMs += Math.round(performance.now() - start); } };
}
