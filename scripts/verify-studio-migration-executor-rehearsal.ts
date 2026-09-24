import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, ObjectId } from "mongodb";

async function main(): Promise<void> {
  const uri = process.env.STUDIO_REHEARSAL_MONGODB_URI;
  if (!process.argv.includes("--confirm-rehearsal") || !uri) throw new Error("guard");
  const target = new URL(uri);
  if (decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "hubzero_studio_rehearsal") throw new Error("guard");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const auth = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
    const roles: unknown[] = auth.authInfo?.authenticatedUserRoles ?? [];
    if (roles.length !== 1 || (roles[0] as { role?: unknown })?.role !== "readWrite"
      || (roles[0] as { db?: unknown })?.db !== "hubzero_studio_rehearsal") throw new Error("guard");
    const database = client.db("hubzero_studio_rehearsal");
    const fixture = JSON.parse(await readFile(resolve(process.cwd(), "test/fixtures/studio-migration-production-shape.json"), "utf8")) as {
      accounts: Array<{ studioUserId: string }>;
      referenceShape: Record<string, unknown>;
    };
    const owner = new ObjectId(fixture.accounts[0]!.studioUserId);
    const ids = fixture.accounts.map((account) => new ObjectId(account.studioUserId));
    const fixtureUsers = await database.collection("users").find({ _id: { $in: ids }, migrationExecutorFixture: true }).toArray();
    if (fixtureUsers.length !== 5 || fixtureUsers.some((user) => typeof user.identitySubject !== "string")) throw new Error("fixture");
    let checkedReferences = 0;
    for (const [path, count] of Object.entries(fixture.referenceShape)) {
      if (path === "team") continue;
      const [collection, field] = path.split(".");
      if (!collection || !field || typeof count !== "number") throw new Error("fixture");
      const documents = await database.collection(collection).find({ migrationExecutorFixture: true }).toArray();
      if (documents.length !== count || documents.some((document) => !(document[field] instanceof ObjectId) || !document[field].equals(owner))) {
        throw new Error("reference");
      }
      checkedReferences += documents.length;
    }
    const team = await database.collection("team").find({ migrationExecutorFixture: true }).toArray();
    if (team.length !== 5 || team.some((item) => item.userId !== undefined)) throw new Error("team");
    process.stdout.write(`${JSON.stringify({ database: "hubzero_studio_rehearsal", mappedFixtureUsers: 5,
      unchangedObjectIdReferences: checkedReferences, unchangedTeamDocuments: 5,
      productionFallback: false })}\n`);
  } finally {
    await client.close();
  }
}

main().catch(() => {
  process.stderr.write("Isolated reference verification failed\n");
  process.exitCode = 1;
});
