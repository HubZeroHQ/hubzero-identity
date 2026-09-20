import { describe, expect, it } from "vitest";
import { buildStudioMigrationManifest } from "./studio-manifest";

const inventory = {
  mode: "read-only-inventory",
  sourceDatabase: "hubzero",
  records: [{
    studioUserId: "507f1f77bcf86cd799439011",
    email: { valid: true, normalizedEmail: "synthetic@example.invalid" },
    role: "admin",
    disabled: false,
    mustChangePassword: false,
    credential: { algorithm: "bcrypt", variant: "2b", cost: 12 },
    identitySubjectPresent: false,
  }],
};

describe("Studio migration manifest", () => {
  it("creates a review plan without reserving an Identity subject", () => {
    expect(buildStudioMigrationManifest(inventory)).toMatchObject({
      summary: { proposedIdentities: 1, studioMemberships: 1, mappings: 1, blocked: 0 },
      items: [{ identityAction: "CREATE NEW SUBJECT", studioMembership: "studio", mappingAction: "SET identitySubject on existing Studio ObjectId" }],
    });
  });

  it("blocks invalid source metadata instead of inventing a migration action", () => {
    const result = buildStudioMigrationManifest({ ...inventory, records: [{ ...inventory.records[0], email: { valid: false }, credential: { algorithm: "unsupported" } }] });
    expect(result.summary.blocked).toBe(1);
    expect(result.items[0]?.warnings).toEqual(["invalid_email", "unsupported_credential_metadata"]);
  });
});
