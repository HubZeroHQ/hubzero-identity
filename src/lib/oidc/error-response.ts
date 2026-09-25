import { errors } from "oidc-provider";

const restartMessage = "That sign-in request is no longer valid. Return to Studio and start again.";

/** Only provider-defined invalid requests are safe to classify as client errors. */
export function oidcNodeErrorResponse(error: unknown): { status: number; message: string; classification: string } {
  if (error instanceof errors.InvalidRequest && error.status >= 400 && error.status < 500) {
    return {
      status: error.status,
      message: error instanceof errors.SessionNotFound ? restartMessage : "Invalid authorization request. Return to Studio and start again.",
      classification: error instanceof errors.SessionNotFound ? "stale_interaction" : "invalid_request",
    };
  }
  return { status: 503, message: "HubZero Identity is temporarily unavailable", classification: "runtime_failure" };
}

export { restartMessage as staleInteractionMessage };
