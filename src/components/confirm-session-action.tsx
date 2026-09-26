"use client";

import { useState, useRef } from "react";
import { useFormStatus } from "react-dom";
import styles from "@/app/account.module.css";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className={styles.dangerButton} disabled={pending}>{pending ? "Signing out…" : "Confirm sign out"}</button>;
}

export function ConfirmSessionAction({ action, sessionId, all = false, disabled = false }: { action: (formData: FormData) => void | Promise<void>; sessionId?: string; all?: boolean; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div>
    <button ref={trigger} className={styles.dangerButton} type="button" disabled={disabled} aria-expanded={confirming} onClick={() => setConfirming(true)}>{all ? "Sign out other sessions" : "Sign out"}</button>
    {confirming && <form action={action} className={styles.confirm}>
      {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
      <p role="status">{all ? "End all other HubZero Account sessions? This browser will stay signed in." : "End this HubZero Account session? That browser will need to sign in again."}</p>
      <div className={styles.confirmActions}><ConfirmButton /><button className={styles.cancel} type="button" onClick={() => { setConfirming(false); trigger.current?.focus(); }}>Cancel</button></div>
    </form>}
  </div>;
}
