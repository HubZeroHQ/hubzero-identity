"use client";

import { useEffect } from "react";

/** Clears only an unusable HttpOnly session cookie after the server selected sign-in. */
export function StaleSessionCleanup() {
  useEffect(() => { void fetch("/internal/session/clear", { method: "POST", credentials: "same-origin" }); }, []);
  return null;
}
