import { parseEnvironment } from "../src/lib/env";
import { getIdentityDatabaseConnection } from "../src/lib/db/mongodb";
import { applyIdentityIndexes } from "../src/lib/db/indexes";

const environment = parseEnvironment(process.env);
const { client, database } = await getIdentityDatabaseConnection(environment);
try {
  const plan = await applyIdentityIndexes(database);
  process.stdout.write(`Verified ${plan.verified.length} indexes; created ${plan.create.length}.\n`);
} finally {
  await client.close();
}
