import type { ClientSession, MongoClient } from "mongodb";

export async function withRequiredTransaction<T>(
  client: MongoClient,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await operation(session);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    if (result === undefined) throw new Error("Transaction completed without a result");
    return result;
  } finally {
    await session.endSession();
  }
}
