import type { Environment } from "@/lib/env";
import { sessionPolicy } from "@/domain/sessions";

export function sessionCookieName(environment: Environment): string {
  return environment.APP_ENV === "development" || environment.APP_ENV === "test"
    ? "hz_session_dev"
    : sessionPolicy.cookieName;
}

export function sessionCookieOptions(environment: Environment, expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: environment.APP_ENV !== "development" && environment.APP_ENV !== "test",
    sameSite: "lax" as const,
    path: "/",
    ...(expiresAt ? { expires: expiresAt, maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) } : { maxAge: 0 }),
  };
}
