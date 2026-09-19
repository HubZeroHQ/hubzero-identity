import { performance } from "node:perf_hooks";
import { PasswordService, currentArgon2idParameters } from "../src/lib/credentials/password";

const service = PasswordService.create();
const samples: number[] = [];
for (let index = 0; index < 5; index += 1) {
  const startedAt = performance.now();
  await service.hash("benchmark-only passphrase");
  samples.push(performance.now() - startedAt);
}
samples.sort((left, right) => left - right);
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
process.stdout.write(`${JSON.stringify({ parameters: currentArgon2idParameters, samplesMs: samples.map(Math.round), meanMs: Math.round(mean), medianMs: Math.round(samples[2]) }, null, 2)}\n`);
