"use client";

import { useActionState, useRef } from "react";
import { updateProfileAction, type ProfileActionState } from "@/app/actions";
import styles from "@/app/sign-in/sign-in.module.css";

const initialState: ProfileActionState = {};

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  const nameInput = useRef<HTMLInputElement>(null);
  return <form action={action} className={styles.form}>
    <label className={styles.field}><span>Name</span><input ref={nameInput} name="name" autoComplete="name" defaultValue={name} required maxLength={120} /></label>
    <label className={styles.field}><span>Email</span><input value={email} type="email" autoComplete="email" readOnly aria-describedby="email-note" /></label>
    <p className={styles.help} id="email-note">Email changes require verification and are not available yet.</p>
    {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
    {state.success ? <p className={styles.success} role="status">Profile updated.</p> : null}
    <div className={styles.actions}><button className={styles.continue} type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><button className={styles.textAction} type="button" disabled={pending} onClick={() => { if (nameInput.current) nameInput.current.value = name; }}>Cancel</button></div>
  </form>;
}
