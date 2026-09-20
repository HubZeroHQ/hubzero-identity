import bcrypt from "bcrypt";
import { describe, expect, it } from "vitest";
import { buildStudioMigrationDryRun, inspectStudioMigrationSource } from "./studio-rehearsal";

const objectId = "65aa00000000000000000001";

describe("Studio migration rehearsal", () => {
  it("reports safe credential metadata without returning a bcrypt hash", async () => {
    const hash = await bcrypt.hash("synthetic rehearsal password", 4);
    const result = inspectStudioMigrationSource([source({ passwordHash: hash })]);

    expect(result.inventory).toMatchObject({
      accountCount: 1,
      credentials: { bcrypt: 1, malformed: 0, missing: 0, costs: { "4": 1 } },
    });
    expect(JSON.stringify(result.inventory)).not.toContain(hash);
  });

  it("blocks normalized-email collisions rather than merging identities", async () => {
    const hash = await bcrypt.hash("synthetic rehearsal password", 4);
    const plan = buildStudioMigrationDryRun([
      source({ passwordHash: hash, email: "Person@Example.com" }),
      source({ studioUserId: "65aa00000000000000000002", passwordHash: hash, email: " person@example.COM " }),
    ], {});

    expect(plan.inventory.normalizedEmailCollisions).toHaveLength(1);
    expect(plan.items.every((item) => item.identityAction === "blocked")).toBe(true);
    expect(plan.items.flatMap((item) => item.warnings)).toContain("normalized_email_collision");
  });

  it("preserves migration-relevant state and makes memberships an explicit input", async () => {
    const hash = await bcrypt.hash("synthetic rehearsal password", 4);
    const plan = buildStudioMigrationDryRun([
      source({ passwordHash: hash, disabled: true, mustChangePassword: true, role: "headAdmin" }),
    ], { [objectId]: ["studio", "fitness", "studio"] });

    expect(plan.items[0]).toMatchObject({
      identityAction: "create_subject_at_apply",
      credentialAction: "import_bcrypt",
      studioMappingAction: "set_identity_subject",
      accountStatus: "suspended",
      mustChangePassword: true,
      role: "headAdmin",
      applicationIds: ["fitness", "studio"],
    });
  });

  it("blocks malformed legacy credentials without exposing the source hash", () => {
    const malformed = "$2b$12$not-a-real-hash";
    const plan = buildStudioMigrationDryRun([source({ passwordHash: malformed })], {});
    expect(plan.items[0]).toMatchObject({ identityAction: "blocked", credentialAction: "blocked" });
    expect(JSON.stringify(plan)).not.toContain(malformed);
  });
});

function source(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    studioUserId: objectId,
    name: "Synthetic Studio User",
    email: "synthetic@example.invalid",
    role: "member",
    disabled: false,
    mustChangePassword: false,
    ...overrides,
  };
}
