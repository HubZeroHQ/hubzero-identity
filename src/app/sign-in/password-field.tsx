"use client";

import { useState } from "react";
import styles from "./sign-in.module.css";

export function PasswordField() {
  const [visible, setVisible] = useState(false);
  return <label className={styles.passwordWrap}>
    <span>Password</span>
    <span className={styles.inputWrap}>
      <input type={visible ? "text" : "password"} name="password" autoComplete="current-password" required />
      <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((value) => !value)}>{visible ? "Hide" : "Show"}</button>
    </span>
  </label>;
}
