import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { AdapterPayload } from "oidc-provider";
import { MongoOidcAdapter } from "./mongo-adapter";

describe("MongoOidcAdapter sparse selector persistence", () => {
  it("omits absent secondary selectors instead of storing indexable nulls", async () => {
    let update: Record<string, unknown> | undefined;
    const database = {
      collection: () => ({
        updateOne: async (_filter: unknown, next: Record<string, unknown>) => { update = next; },
      }),
    } as unknown as Db;

    await new MongoOidcAdapter("Session", database, Buffer.alloc(32, 7)).upsert("artifact", {} as AdapterPayload, 60);

    expect((update?.$set as Record<string, unknown>).uidLookup).toBeUndefined();
    expect((update?.$set as Record<string, unknown>).userCodeLookup).toBeUndefined();
    expect((update?.$set as Record<string, unknown>).grantLookup).toBeUndefined();
    expect(update?.$unset).toEqual({ uidLookup: "", userCodeLookup: "", grantLookup: "" });
  });

  it("persists a uid selector only when oidc-provider supplies one", async () => {
    let update: Record<string, unknown> | undefined;
    const database = {
      collection: () => ({
        updateOne: async (_filter: unknown, next: Record<string, unknown>) => { update = next; },
      }),
    } as unknown as Db;

    await new MongoOidcAdapter("Interaction", database, Buffer.alloc(32, 9)).upsert("artifact", { uid: "interaction-uid" } as AdapterPayload, 60);

    expect((update?.$set as Record<string, unknown>).uidLookup).toEqual(expect.any(String));
    expect(update?.$unset).toEqual({ userCodeLookup: "", grantLookup: "" });
  });
});
