import { chromium } from "@playwright/test";

const baseUrl = process.env.VERCEL_REHEARSAL_URL;
const email = process.env.REHEARSAL_TEST_EMAIL;
const password = process.env.REHEARSAL_TEST_PASSWORD;

if (!baseUrl || !email || !password) throw new Error("VERCEL_REHEARSAL_URL, REHEARSAL_TEST_EMAIL, and REHEARSAL_TEST_PASSWORD are required");
const origin = new URL(baseUrl).origin;
if (!origin.endsWith(".vercel.app") || !email.endsWith("@example.invalid")) {
  throw new Error("This browser check accepts only an isolated Vercel rehearsal origin and synthetic example.invalid identity");
}

const browser = await chromium.launch({ headless: true });
try {
  const rejected = await browser.newContext();
  const rejectedPage = await rejected.newPage();
  await rejectedPage.goto(`${origin}/sign-in`);
  await rejectedPage.getByRole("textbox", { name: "Email" }).fill(email);
  await rejectedPage.getByRole("textbox", { name: "Password" }).fill(`${password}-incorrect`);
  await rejectedPage.getByRole("button", { name: "Continue" }).click();
  await rejectedPage.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Continuing")), undefined, { timeout: 20_000 });
  const rejectedMessage = (await rejectedPage.locator("#sign-in-status").textContent())?.trim();
  if (rejectedMessage !== "Email or password is incorrect.") throw new Error(`Credential failure category was unexpected: ${JSON.stringify(rejectedMessage)}`);
  await rejected.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/sign-in`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Your account" }).waitFor();
  await page.goto(`${origin}/sessions`);
  await page.getByRole("heading", { name: "Sessions" }).waitFor();
  const identityCookie = (await context.cookies(origin)).find((cookie) => cookie.name === "hz_session_dev");
  if (!identityCookie?.httpOnly) throw new Error("Identity session cookie was not created as HttpOnly");
  process.stdout.write(`${JSON.stringify({ origin, genericCredentialFailure: true, syntheticCredentialSignIn: true, identitySessionLookup: true, identityCookie: { present: true, httpOnly: true } })}\n`);
  await context.close();
} finally {
  await browser.close();
}
