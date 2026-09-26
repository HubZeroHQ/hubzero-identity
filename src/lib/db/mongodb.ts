import { attachDatabasePool } from "@vercel/functions";
import { MongoClient, type Db } from "mongodb";
import type { Environment } from "@/lib/env";
import { mongoCommandTimer, timed } from "@/lib/observability/timing";

let clientPromise: Promise<MongoClient> | undefined;

export interface IdentityDatabaseConnection {
  client: MongoClient;
  database: Db;
}

export async function getIdentityDatabaseConnection(environment: Environment): Promise<IdentityDatabaseConnection> {
  if (!clientPromise) {
    const client = new MongoClient(environment.MONGODB_URI, {
      appName: "hubzero-identity",
      retryWrites: true,
      monitorCommands: true,
    });
    const pending = new Map<number, () => void>();
    client.on("commandStarted", (event) => pending.set(event.requestId, mongoCommandTimer()));
    const finish = (event: { requestId: number }) => { pending.get(event.requestId)?.(); pending.delete(event.requestId); };
    client.on("commandSucceeded", finish);
    client.on("commandFailed", finish);
    // On Vercel Fluid compute this releases idle Mongo connections before an
    // instance suspends. It is harmless in the portable Node/Docker runtime.
    attachDatabasePool(client);
    clientPromise = timed("mongoConnect", () => client.connect()).catch((error) => {
      // A transient cold-start failure must not poison a warm instance forever.
      clientPromise = undefined;
      throw error;
    });
  }
  const client = await clientPromise;
  return { client, database: client.db(environment.MONGODB_DATABASE) };
}

export async function getIdentityDatabase(environment: Environment): Promise<Db> {
  return (await getIdentityDatabaseConnection(environment)).database;
}
