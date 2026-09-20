import { z } from "zod";

const sourceRecordSchema = z.object({
  studioUserId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  email: z.union([
    z.object({ valid: z.literal(true), normalizedEmail: z.string().min(1) }),
    z.object({ valid: z.literal(false) }),
  ]),
  role: z.string(),
  disabled: z.boolean(),
  mustChangePassword: z.boolean(),
  credential: z.object({
    algorithm: z.string(),
    variant: z.string().optional(),
    cost: z.number().int().optional(),
  }),
  identitySubjectPresent: z.boolean(),
});

const inventorySchema = z.object({
  mode: z.literal("read-only-inventory"),
  sourceDatabase: z.literal("hubzero"),
  records: z.array(sourceRecordSchema),
});

export interface StudioMigrationManifestItem {
  sourceStudioUserId: string;
  normalizedEmail: string | null;
  role: string;
  accountStatus: "active" | "suspended";
  mustChangePassword: boolean;
  credential: { algorithm: string; variant?: string; cost?: number };
  identityAction: "CREATE NEW SUBJECT" | "BLOCKED";
  studioMembership: "studio" | null;
  mappingAction: "SET identitySubject on existing Studio ObjectId" | "BLOCKED";
  warnings: string[];
}

/**
 * Turns the read-only, hash-free production inventory into an operator-review
 * plan. It deliberately cannot create subjects, hashes, memberships, or
 * mappings; Phase 7 must generate opaque subjects only at approved apply time.
 */
export function buildStudioMigrationManifest(rawInventory: unknown): {
  schemaVersion: 1;
  sourceDatabase: "hubzero";
  items: StudioMigrationManifestItem[];
  summary: { proposedIdentities: number; studioMemberships: number; mappings: number; blocked: number };
} {
  const inventory = inventorySchema.parse(rawInventory);
  const items = inventory.records.map((record) => {
    const warnings: string[] = [];
    if (!record.email.valid) warnings.push("invalid_email");
    if (record.credential.algorithm !== "bcrypt" || !record.credential.variant || record.credential.cost === undefined) warnings.push("unsupported_credential_metadata");
    if (record.identitySubjectPresent) warnings.push("identity_subject_already_present");
    const blocked = warnings.length > 0;
    return {
      sourceStudioUserId: record.studioUserId,
      normalizedEmail: record.email.valid ? record.email.normalizedEmail : null,
      role: record.role,
      accountStatus: record.disabled ? "suspended" as const : "active" as const,
      mustChangePassword: record.mustChangePassword,
      credential: record.credential,
      identityAction: blocked ? "BLOCKED" as const : "CREATE NEW SUBJECT" as const,
      studioMembership: blocked ? null : "studio" as const,
      mappingAction: blocked ? "BLOCKED" as const : "SET identitySubject on existing Studio ObjectId" as const,
      warnings,
    };
  });
  const blocked = items.filter((item) => item.identityAction === "BLOCKED").length;
  return {
    schemaVersion: 1,
    sourceDatabase: "hubzero",
    items,
    summary: {
      proposedIdentities: items.length - blocked,
      studioMemberships: items.filter((item) => item.studioMembership === "studio").length,
      mappings: items.filter((item) => item.mappingAction !== "BLOCKED").length,
      blocked,
    },
  };
}
