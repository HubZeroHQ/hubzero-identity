import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env";

const base = {
  APP_ENV: "development",
  IDENTITY_ISSUER_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/hubzero_identity_dev",
  MONGODB_DATABASE: "hubzero_identity_dev",
};

describe("environment validation", () => {
  it("allows a safe local baseline", () => expect(parseEnvironment(base)).toBeTruthy());
  it("requires HTTPS and secrets in production", () => {
    expect(() => parseEnvironment({ ...base, APP_ENV: "production" })).toThrow();
  });
});
