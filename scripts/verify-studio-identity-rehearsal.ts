import { chromium } from '@playwright/test';

const studioUrl = process.env.STUDIO_REHEARSAL_URL;
const issuer = process.env.VERCEL_REHEARSAL_URL;
const email = process.env.STUDIO_REHEARSAL_EMAIL;
const password = process.env.STUDIO_REHEARSAL_PASSWORD;
if (!studioUrl || !issuer || !email || !password || !email.endsWith('@example.invalid')) {
  throw new Error('Missing synthetic Studio-to-Identity rehearsal inputs');
}

const browser = await chromium.launch({ headless: true });
const isStudioSessionCookie = (cookie: { name: string }) => /(?:^|__)authjs\.session-token/.test(cookie.name);
try {
  const legacy = await browser.newContext();
  const legacyPage = await legacy.newPage();
  await legacyPage.goto(`${studioUrl}/studio/login`);
  await legacyPage.getByLabel('Email').fill(email);
  await legacyPage.getByRole('textbox', { name: 'Password' }).fill(password);
  await legacyPage.getByRole('button', { name: 'Sign in' }).click();
  await legacyPage.waitForURL(/\/studio\/dashboard/, { timeout: 30_000 });
  const legacyStudioSession = (await legacy.cookies()).some((cookie) => cookie.domain === new URL(studioUrl).hostname && isStudioSessionCookie(cookie));
  await legacy.close();

  const oidc = await browser.newContext();
  const page = await oidc.newPage();
  await page.goto(`${studioUrl}/studio/login`);
  await page.getByRole('link', { name: /Continue with HubZero/ }).click();
  await page.waitForURL(new RegExp(`${new URL(issuer).hostname.replaceAll('.', '\\.')}`), { timeout: 30_000 });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/authorize\/interaction/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue with HubZero' }).click();
  await page.waitForURL(/\/studio\/dashboard/, { timeout: 45_000 });
  const cookies = await oidc.cookies();
  const studioSession = cookies.some((cookie) => cookie.domain === new URL(studioUrl).hostname && isStudioSessionCookie(cookie));
  const identitySession = cookies.some((cookie) => cookie.domain === new URL(issuer).hostname && cookie.name === '__Host-hz_session');
  if (!legacyStudioSession || !studioSession || !identitySession) throw new Error('Expected independent Studio and Identity sessions were not retained');
  await oidc.clearCookies({ domain: new URL(studioUrl).hostname });
  await page.goto(`${studioUrl}/studio/login`);
  await page.getByRole('link', { name: /Continue with HubZero/ }).click();
  await page.waitForURL(/(?:\/authorize\/interaction|\/studio\/dashboard)/, { timeout: 30_000 });
  if (await page.getByRole('textbox', { name: 'Password' }).isVisible().catch(() => false)) {
    throw new Error('Identity SSO unexpectedly requested a second password');
  }
  if (/\/authorize\/interaction/.test(new URL(page.url()).pathname)) {
    await page.getByRole('button', { name: 'Continue with HubZero' }).click();
    await page.waitForURL(/\/studio\/dashboard/, { timeout: 45_000 });
  }
  const reusedStudioSession = (await oidc.cookies()).some(
    (cookie) => cookie.domain === new URL(studioUrl).hostname && isStudioSessionCookie(cookie),
  );
  if (!reusedStudioSession) throw new Error('Identity SSO did not establish a new Studio session');
  process.stdout.write(`${JSON.stringify({ legacyLogin: true, oidcLogin: true, identitySsoReuse: true, independentSessions: true, studioSessionHost: new URL(studioUrl).hostname, identitySessionHost: new URL(issuer).hostname })}\n`);
  await oidc.close();
} finally {
  await browser.close();
}
