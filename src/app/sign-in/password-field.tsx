"use client";

import { useId, useState } from "react";
import type { RefObject } from "react";
import styles from "./sign-in.module.css";

export function PasswordField({ name = "password", autoComplete = "current-password", label = "Password", describedBy, inputRef }: { name?: string; autoComplete?: string; label?: string; describedBy?: string; inputRef?: RefObject<HTMLInputElement | null> }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return <div className={styles.passwordWrap}>
    <label htmlFor={id}>{label}</label>
    <span className={styles.inputWrap}>
      <input ref={inputRef} id={id} type={visible ? "text" : "password"} name={name} autoComplete={autoComplete} aria-describedby={describedBy} required />
      <button type="button" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? "Hide" : "Show"}</button>
    </span>
  </div>;
}
