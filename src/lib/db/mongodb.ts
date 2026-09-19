import { MongoClient, type Db } from "mongodb";
import type { Environment } from "@/lib/env";

let clientPromise: Promise<MongoClient> | undefined;

export async function getIdentityDatabase(environment: Environment): Promise<Db> {
  clientPromise ??= new MongoClient(environment.MONGODB_URI, {
    appName: "hubzero-identity",
    retryWrites: true,
  }).connect();
  const client = await clientPromise;
  return client.db(environment.MONGODB_DATABASE);
}
