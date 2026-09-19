"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordActionState } from "@/app/actions";
import { PasswordField } from "@/app/sign-in/password-field";
import styles from "@/app/sign-in/sign-in.module.css";

const initialState: PasswordActionState = {};

export function PasswordChangeForm({ forced }: { forced: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  const message = state.error === "current" ? "Your current password is incorrect."
    : state.error === "confirmation" ? "The new password and confirmation do not match."
      : state.error === "policy" ? state.message ?? "Choose a password that meets the policy."
        : state.error === "unavailable" ? "Your password could not be changed right now. Try again shortly."
          : null;
  return <form action={action} className={styles.form} aria-describedby={message ? "password-status" : undefined}>
    <PasswordField name="currentPassword" label="Current password" autoComplete="current-password" />
    <PasswordField name="newPassword" label="New password" autoComplete="new-password" describedBy="password-guidance" />
    <PasswordField name="confirmation" label="Confirm new password" autoComplete="new-password" />
    <p className={styles.help} id="password-guidance">Use at least 12 characters. A longer passphrase is welcome.</p>
    {message ? <p id="password-status" className={styles.error} role="alert">{message}</p> : null}
    <button className={styles.continue} type="submit" disabled={pending}>{pending ? "Changing password…" : forced ? "Set new password" : "Change password"}</button>
  </form>;
}
