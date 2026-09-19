import { CredentialService } from "@/lib/credentials/service";
import { PasswordService } from "@/lib/credentials/password";
import { getIdentityDatabaseConnection } from "@/lib/db/mongodb";
import { parseEnvironment, type Environment } from "@/lib/env";
import { MongoFixedWindowRateLimiter } from "@/lib/rate-limit/rate-limiter";
import { decodeRequiredBase64Key } from "@/lib/security/crypto";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { SessionService } from "@/lib/sessions/service";
import type { Db, MongoClient } from "mongodb";

export interface IdentityRuntime {
  environment: Environment;
  database: Db;
  client: MongoClient;
  credentials: CredentialService;
  passwords: PasswordService;
  sessions: SessionService;
  rateLimiter: MongoFixedWindowRateLimiter;
  events: MongoSecurityEventWriter;
}

export async function createIdentityRuntime(environment: Environment): Promise<IdentityRuntime> {
  const { client, database } = await getIdentityDatabaseConnection(environment);
  const events = new MongoSecurityEventWriter(database);
  const passwords = PasswordService.create();
  return {
    environment,
    database,
    client,
    passwords,
    events,
    credentials: new CredentialService(database, client, passwords, events),
    sessions: new SessionService(database, client, decodeRequiredBase64Key(environment.SESSION_HMAC_KEY_BASE64!, "SESSION_HMAC_KEY_BASE64"), events),
    rateLimiter: new MongoFixedWindowRateLimiter(database, decodeRequiredBase64Key(environment.RATE_LIMIT_HMAC_KEY_BASE64!, "RATE_LIMIT_HMAC_KEY_BASE64"), events),
  };
}

export async function getIdentityRuntime(): Promise<IdentityRuntime> {
  return createIdentityRuntime(parseEnvironment(process.env));
}
