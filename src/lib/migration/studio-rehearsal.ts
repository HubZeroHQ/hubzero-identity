import { z } from "zod";
import { normalizeEmail } from "@/lib/identity/email";
import { CredentialFormatError, parseBcryptHash } from "@/lib/credentials/password";

const roleSchema = z.enum(["headAdmin", "admin", "member"]);
const sourceUserSchema = z.object({
  studioUserId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().min(1).max(320),
  role: roleSchema,
  disabled: z.boolean(),
  mustChangePassword: z.boolean(),
  passwordHash: z.string().optional(),
  image: z.string().url().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type StudioMigrationSourceUser = z.infer<typeof sourceUserSchema>;

export interface StudioMigrationInventory {
  accountCount: number;
  normalizedEmailCollisions: Array<{ normalizedEmail: string; studioUserIds: string[] }>;
  invalidEmails: Array<{ studioUserId: string; reason: string }>;
  roles: Record<z.infer<typeof roleSchema>, number>;
  disabledCount: number;
  mustChangePasswordCount: number;
  credentials: { bcrypt: number; missing: number; malformed: number; costs: Record<string, number> };
}

export interface StudioMigrationPlanItem {
  studioUserId: string;
  email: string | null;
  role: z.infer<typeof roleSchema>;
  identityAction: "create_subject_at_apply" | "blocked";
  credentialAction: "import_bcrypt" | "no_credential" | "blocked";
  studioMappingAction: "set_identity_subject" | "blocked";
  accountStatus: "active" | "suspended";
  mustChangePassword: boolean;
  applicationIds: string[];
  warnings: string[];
}

/**
 * Read-only inventory and dry-run planning for a controlled Studio source
 * export. It intentionally never opens a database, returns no password hash,
 * and has no apply mode; Phase 6 owns an operator-approved cross-database
 * execution command and migration journal.
 */
export function inspectStudioMigrationSource(rawUsers: unknown[]): {
  users: StudioMigrationSourceUser[];
  inventory: StudioMigrationInventory;
} {
  const users = rawUsers.map((raw) => sourceUserSchema.parse(raw));
  const roles = { headAdmin: 0, admin: 0, member: 0 };
  const normalized = new Map<string, string[]>();
  const invalidEmails: StudioMigrationInventory["invalidEmails"] = [];
  const credentials: StudioMigrationInventory["credentials"] = { bcrypt: 0, missing: 0, malformed: 0, costs: {} };

  for (const user of users) {
    roles[user.role] += 1;
    try {
      const email = normalizeEmail(user.email).normalizedEmail;
      normalized.set(email, [...(normalized.get(email) ?? []), user.studioUserId]);
    } catch (error) {
      invalidEmails.push({ studioUserId: user.studioUserId, reason: error instanceof Error ? error.message : "Invalid email" });
    }
    if (!user.passwordHash) {
      credentials.missing += 1;
      continue;
    }
    try {
      const bcrypt = parseBcryptHash(user.passwordHash);
      credentials.bcrypt += 1;
      credentials.costs[String(bcrypt.cost)] = (credentials.costs[String(bcrypt.cost)] ?? 0) + 1;
    } catch (error) {
      if (error instanceof CredentialFormatError) credentials.malformed += 1;
      else throw error;
    }
  }

  return {
    users,
    inventory: {
      accountCount: users.length,
      normalizedEmailCollisions: [...normalized.entries()]
        .filter(([, studioUserIds]) => studioUserIds.length > 1)
        .map(([normalizedEmail, studioUserIds]) => ({ normalizedEmail, studioUserIds })),
      invalidEmails,
      roles,
      disabledCount: users.filter((user) => user.disabled).length,
      mustChangePasswordCount: users.filter((user) => user.mustChangePassword).length,
      credentials,
    },
  };
}

export function buildStudioMigrationDryRun(
  rawUsers: unknown[],
  membershipsByStudioUserId: Readonly<Record<string, readonly string[]>>,
): { inventory: StudioMigrationInventory; items: StudioMigrationPlanItem[] } {
  const { users, inventory } = inspectStudioMigrationSource(rawUsers);
  const collidingIds = new Set(inventory.normalizedEmailCollisions.flatMap((collision) => collision.studioUserIds));
  const invalidIds = new Set(inventory.invalidEmails.map((entry) => entry.studioUserId));

  return {
    inventory,
    items: users.map((user) => {
      const warnings: string[] = [];
      if (collidingIds.has(user.studioUserId)) warnings.push("normalized_email_collision");
      if (invalidIds.has(user.studioUserId)) warnings.push("invalid_email");
      const credential = legacyCredentialAction(user.passwordHash);
      if (credential === "blocked") warnings.push("unsupported_credential_format");
      if (credential === "no_credential") warnings.push("missing_credential");
      const blocked = warnings.some((warning) => warning === "normalized_email_collision" || warning === "invalid_email" || warning === "unsupported_credential_format");
      let email: string | null = null;
      if (!invalidIds.has(user.studioUserId)) email = normalizeEmail(user.email).email;
      return {
        studioUserId: user.studioUserId,
        email,
        role: user.role,
        identityAction: blocked ? "blocked" : "create_subject_at_apply",
        credentialAction: blocked ? "blocked" : credential,
        studioMappingAction: blocked ? "blocked" : "set_identity_subject",
        accountStatus: user.disabled ? "suspended" : "active",
        mustChangePassword: user.mustChangePassword,
        applicationIds: [...new Set(membershipsByStudioUserId[user.studioUserId] ?? [])].sort(),
        warnings,
      };
    }),
  };
}

function legacyCredentialAction(hash: string | undefined): StudioMigrationPlanItem["credentialAction"] {
  if (!hash) return "no_credential";
  try {
    parseBcryptHash(hash);
    return "import_bcrypt";
  } catch (error) {
    if (error instanceof CredentialFormatError) return "blocked";
    throw error;
  }
}
