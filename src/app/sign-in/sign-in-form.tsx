"use client";

import { useActionState, useEffect, useRef } from "react";
import { signInAction, type SignInActionState } from "@/app/actions";
import { PasswordField } from "./password-field";
import styles from "./sign-in.module.css";

const initialState: SignInActionState = {};

export function SignInForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState(signInAction, initialState);
  const password = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.attempt && password.current) password.current.value = ""; }, [state.attempt]);
  const message = state.error === "rate_limited"
    ? `Too many attempts. Try again in about ${Math.max(1, Math.ceil((state.retryAfterSeconds ?? 60) / 60))} minute${(state.retryAfterSeconds ?? 60) > 90 ? "s" : ""}.`
    : state.error === "suspended"
      ? "This HubZero Account is currently unavailable."
      : state.error === "unavailable"
        ? "Sign-in is temporarily unavailable. Try again shortly."
        : state.error === "invalid"
          ? "Email or password is incorrect."
          : null;
  return <form action={action} className={styles.form} aria-describedby={message ? "sign-in-status" : undefined}>
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className={styles.field}><span>Email</span><input type="email" name="email" autoComplete="email" defaultValue={state.email} required maxLength={320} /></label>
    <PasswordField inputRef={password} />
    {message ? <p id="sign-in-status" className={styles.error} role="alert">{message}</p> : null}
    <button className={styles.continue} type="submit" disabled={pending}>{pending ? "Continuing…" : "Continue"}</button>
    <p className={styles.help}>Password recovery is not available yet. Contact an authorized HubZero operator if you need help.</p>
  </form>;
}
