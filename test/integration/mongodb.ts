import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";

const execFileAsync = promisify(execFile);
const mongoImage = "mongo@sha256:4968f22d0c6c10ef29952f3e807f62872ba22b3312f25803564fbfc08255efc2";

export interface MongoTestInstance {
  client: MongoClient;
  stop(): Promise<void>;
}

export async function startMongoReplicaSet(): Promise<MongoTestInstance> {
  const suffix = randomBytes(6).toString("hex");
  const containerName = `hz-identity-test-${suffix}`;
  try {
    await execFileAsync("docker", ["info"], { timeout: 15_000, windowsHide: true });
  } catch (error) {
    throw new Error("MongoDB integration tests require a running Docker engine", { cause: error });
  }

  await execFileAsync("docker", [
    "run", "--detach", "--rm", "--name", containerName,
    "--publish", "127.0.0.1::27017",
    mongoImage, "--replSet", "rs0", "--bind_ip_all",
  ], { timeout: 120_000, windowsHide: true });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (!/^hz-identity-test-[a-f0-9]{12}$/.test(containerName)) throw new Error("Refusing to remove an unexpected container name");
    await execFileAsync("docker", ["rm", "--force", containerName], { timeout: 30_000, windowsHide: true }).catch(() => undefined);
  };

  try {
    await retry(async () => {
      await execFileAsync("docker", ["exec", containerName, "mongosh", "--quiet", "--eval", "db.adminCommand({ping:1}).ok"], { timeout: 10_000, windowsHide: true });
    }, 60, 500);
    await execFileAsync("docker", ["exec", containerName, "mongosh", "--quiet", "--eval", "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"], { timeout: 20_000, windowsHide: true });
    await retry(async () => {
      const { stdout } = await execFileAsync("docker", ["exec", containerName, "mongosh", "--quiet", "--eval", "db.hello().isWritablePrimary"], { timeout: 10_000, windowsHide: true });
      if (!stdout.includes("true")) throw new Error("Replica set is not primary yet");
    }, 60, 500);
    const { stdout } = await execFileAsync("docker", ["port", containerName, "27017/tcp"], { timeout: 10_000, windowsHide: true });
    const port = /127\.0\.0\.1:(\d+)/.exec(stdout)?.[1];
    if (!port) throw new Error(`Could not determine MongoDB test port from: ${stdout}`);
    const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, {
      appName: "hubzero-identity-integration-tests",
      serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();
    return { client, stop: async () => { await client.close(); await stop(); } };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function retry(operation: () => Promise<void>, attempts: number, delayMs: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
