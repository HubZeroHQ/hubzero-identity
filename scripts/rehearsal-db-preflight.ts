import { MongoClient } from "mongodb";

const DATABASE = "hubzero_identity_rehearsal";
const uri = process.env.REHEARSAL_MONGODB_URI;
if (!uri) throw new Error("REHEARSAL_MONGODB_URI is required; runtime MONGODB_URI is never used for rehearsal preflight");
if (decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, "")) !== DATABASE) {
  throw new Error("Rehearsal URI must explicitly target hubzero_identity_rehearsal");
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
  const roles = status.authInfo?.authenticatedUserRoles ?? [];
  if (roles.length !== 1 || roles[0]?.role !== "readWrite" || roles[0]?.db !== DATABASE) {
    throw new Error("Rehearsal database requires exactly one dedicated readWrite@hubzero_identity_rehearsal role; refusing this credential");
  }
  process.stdout.write(`${JSON.stringify({ mode: "rehearsal-preflight", database: DATABASE, authenticatedRoles: ["readWrite@hubzero_identity_rehearsal"], runtimeMongoUriUsed: false, mutationPathsExecuted: false, indexInitializationExecuted: false })}\n`);
} finally {
  await client.close();
}
