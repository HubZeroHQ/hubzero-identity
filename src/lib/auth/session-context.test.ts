import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), runtime: vi.fn(), resolve: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }), headers: vi.fn() }));
vi.mock("@/lib/env", () => ({ parseEnvironment: () => ({ APP_ENV: "production" }) }));
vi.mock("./runtime", () => ({ getIdentityRuntime: mocks.runtime }));
vi.mock("./session-resolution", () => ({ resolveIdentitySessionToken: mocks.resolve }));
import { getCurrentIdentity } from "./session-context";

describe("anonymous sign-in fast path", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not initialize Mongo or native-password services without a session cookie", async () => {
    mocks.cookie.mockReturnValue(undefined);
    expect(await getCurrentIdentity()).toBeNull();
    expect(mocks.cookie).toHaveBeenCalledWith("__Host-hz_session");
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("still validates every present cookie through the existing session service", async () => {
    mocks.cookie.mockReturnValue({ value: "invalid-test-cookie" });
    mocks.runtime.mockResolvedValue({ sentinel: true });
    mocks.resolve.mockResolvedValue(null);
    expect(await getCurrentIdentity()).toBeNull();
    expect(mocks.resolve).toHaveBeenCalledWith({ sentinel: true }, "invalid-test-cookie");
  });
});
