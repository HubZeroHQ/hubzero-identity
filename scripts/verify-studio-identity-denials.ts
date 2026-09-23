import { chromium } from '@playwright/test';

const studioUrl = process.env.STUDIO_REHEARSAL_URL;
const issuer = process.env.VERCEL_REHEARSAL_URL;
const password = process.env.STUDIO_REHEARSAL_PASSWORD;
const noMembershipEmail = process.env.STUDIO_REHEARSAL_NO_MEMBERSHIP_EMAIL;
const noMappingEmail = process.env.STUDIO_REHEARSAL_NO_MAPPING_EMAIL;
const disabledEmail = process.env.STUDIO_REHEARSAL_DISABLED_EMAIL;

if (!studioUrl || !issuer || !password || !noMembershipEmail || !noMappingEmail || !disabledEmail) {
  throw new Error('Missing isolated Studio denial rehearsal inputs');
}

const browser = await chromium.launch({ headless: true });
try {
  await expectMembershipDenial(noMembershipEmail);
  await expectStudioDenial(noMappingEmail);
  await expectStudioDenial(disabledEmail);
  process.stdout.write(`${JSON.stringify({ membershipDenied: true, mappingDenied: true, disabledStudioUserDenied: true })}\n`);
} finally {
  await browser.close();
}

async function start(email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${studioUrl}/studio/login`);
  await page.getByRole('link', { name: /Continue with HubZero/ }).click();
  await page.waitForURL(new RegExp(new URL(issuer!).hostname.replaceAll('.', '\\.')), { timeout: 30_000 });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await Promise.race([
    page.waitForURL(/\/authorize\/interaction/, { timeout: 30_000 }),
    page.getByRole('heading', { name: 'Access unavailable' }).waitFor({ timeout: 30_000 }),
  ]);
  const identitySession = (await context.cookies()).some(
    (cookie) => cookie.domain === new URL(issuer!).hostname && cookie.name === '__Host-hz_session',
  );
  if (!identitySession) throw new Error('Synthetic Identity session cookie was not established before Studio authorization');
  return { context, page };
}

async function expectMembershipDenial(email: string) {
  const { context, page } = await start(email);
  try {
    await page.getByRole('heading', { name: 'Access unavailable' }).waitFor({ timeout: 30_000 });
    await assertNoStudioSession(context);
  } finally {
    await context.close();
  }
}

async function expectStudioDenial(email: string) {
  const { context, page } = await start(email);
  try {
    await page.getByRole('button', { name: 'Continue with HubZero' }).click({ noWaitAfter: true });
    await page.waitForURL(/\/studio\/login\?oidcError=1/, { timeout: 45_000 });
    await assertNoStudioSession(context);
  } finally {
    await context.close();
  }
}

async function assertNoStudioSession(context: import('@playwright/test').BrowserContext) {
  if ((await context.cookies()).some((cookie) => cookie.domain === new URL(studioUrl!).hostname && /(?:^|__)authjs\.session-token/.test(cookie.name))) {
    throw new Error('Denied OIDC flow established a Studio session');
  }
}
