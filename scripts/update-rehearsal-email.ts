import { MongoClient } from "mongodb";
import { normalizeEmail } from "@/lib/identity/email";

const uri = process.env.REHEARSAL_MONGODB_URI;
const subject = process.env.REHEARSAL_IDENTITY_SUBJECT;
const email = process.env.REHEARSAL_IDENTITY_EMAIL;

if (!uri || new URL(uri).pathname.replace(/^\/+/, "") !== "hubzero_identity_rehearsal") {
  throw new Error("This command accepts only the isolated Identity rehearsal database");
}
if (!subject || !/^hz_[0-9A-HJKMNP-TV-Z]{26}$/.test(subject) || !email?.endsWith("@example.invalid")) {
  throw new Error("Synthetic rehearsal email inputs are invalid");
}

const normalized = normalizeEmail(email);
const client = new MongoClient(uri);
try {
  await client.connect();
  const result = await client.db("hubzero_identity_rehearsal").collection("identity_users").updateOne(
    { subject },
    { $set: { email: normalized.email, normalizedEmail: normalized.normalizedEmail, emailNormalizationVersion: normalized.version, updatedAt: new Date() } },
  );
  if (result.matchedCount !== 1) throw new Error("Synthetic rehearsal account was not found");
  process.stdout.write(`${JSON.stringify({ database: "hubzero_identity_rehearsal", subject, emailUpdated: true })}\n`);
} finally {
  await client.close();
}
