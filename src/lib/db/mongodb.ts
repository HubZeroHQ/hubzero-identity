import { MongoClient, type Db } from "mongodb";
import type { Environment } from "@/lib/env";

let clientPromise: Promise<MongoClient> | undefined;

export interface IdentityDatabaseConnection {
  client: MongoClient;
  database: Db;
}

export async function getIdentityDatabaseConnection(environment: Environment): Promise<IdentityDatabaseConnection> {
  clientPromise ??= new MongoClient(environment.MONGODB_URI, {
    appName: "hubzero-identity",
    retryWrites: true,
  }).connect();
  const client = await clientPromise;
  return { client, database: client.db(environment.MONGODB_DATABASE) };
}

export async function getIdentityDatabase(environment: Environment): Promise<Db> {
  return (await getIdentityDatabaseConnection(environment)).database;
}
