"use client";

import { useEffect } from "react";

/** Rotates only an HttpOnly cookie; no bearer material reaches React. */
export function SessionRefresh({ needed }: { needed: boolean }) {
  useEffect(() => {
    if (!needed) return;
    void fetch("/internal/session/refresh", { method: "POST", credentials: "same-origin", headers: { "x-hz-session-refresh": "1" } });
  }, [needed]);
  return null;
}
