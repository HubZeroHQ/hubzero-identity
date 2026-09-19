import { AuthShell } from "@/components/auth-shell";
import { Button, Field } from "@/components/ui";
import { PasswordField } from "./password-field";
import { PreviewForm } from "@/components/preview-form";
import styles from "./sign-in.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <AuthShell application={{ name: "HubZero Fitness", domain: "fitness.hubzero.in", initial: "F" }}>
    <header className={styles.heading}><h1>Welcome back</h1><p>Use your HubZero Account to continue.</p></header>
    <PreviewForm className={styles.form} describedBy="preview-note">
      <Field label="Email" type="email" autoComplete="username" />
      <PasswordField />
      <span className={styles.fullButton}><Button type="submit">Continue</Button></span>
      <a className={styles.forgot} href="#recovery">Forgot password?</a>
      <p className={styles.notice} id="preview-note">This Phase 1 screen is a non-functional design preview. It does not accept or send credentials.</p>
    </PreviewForm>
  </AuthShell>;
}
