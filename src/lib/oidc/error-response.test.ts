import { describe, expect, it } from "vitest";
import { errors } from "oidc-provider";
import { oidcNodeErrorResponse, staleInteractionMessage } from "./error-response";

describe("OIDC Node error responses", () => {
  it("classifies consumed or missing interactions as safe invalid requests", () => {
    const response = oidcNodeErrorResponse(new errors.SessionNotFound("private interaction detail"));
    expect(response).toEqual({ status: 400, message: staleInteractionMessage, classification: "stale_interaction" });
    expect(response.message).not.toContain("private interaction detail");
  });

  it("preserves a safe provider invalid-request status without exposing details", () => {
    const response = oidcNodeErrorResponse(new errors.InvalidRequest("private protocol detail", 403));
    expect(response.status).toBe(403);
    expect(response.classification).toBe("invalid_request");
    expect(response.message).not.toContain("private protocol detail");
  });

  it("keeps unexpected and service errors on the 5xx path", () => {
    for (const error of [new Error("private database detail"), new errors.OIDCProviderError(500, "private provider detail")]) {
      const response = oidcNodeErrorResponse(error);
      expect(response).toEqual({ status: 503, message: "HubZero Identity is temporarily unavailable", classification: "runtime_failure" });
    }
  });

  it("does not trust a status-like field or error name on an unrelated error", () => {
    const response = oidcNodeErrorResponse(Object.assign(new Error("private detail"), { status: 400, name: "SessionNotFound" }));
    expect(response.status).toBe(503);
  });
});
