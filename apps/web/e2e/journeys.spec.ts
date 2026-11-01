import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_PASSWORD, users } from './global-setup';

/**
 * GAP-07 smoke journeys, run serially against one seeded database. Selectors are accessible
 * names (labels, roles, button text) so the suite doubles as a basic a11y check.
 */
test.describe.configure({ mode: 'serial' });

const SINK = 'http://127.0.0.1:8026/messages';
const ada = { name: 'Ada Lovelace', email: 'ada@e2e.test', password: 'ada-e2e-password' };
const state: { wid?: string; pid?: string; issuePath?: string } = {};

async function mailLink(to: string, pattern: RegExp): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const messages = (await (await fetch(SINK)).json()) as { to: string[]; text: string }[];
    const hit = [...messages].reverse().find((m) => m.to.includes(to) && pattern.test(m.text));
    if (hit) return pattern.exec(hit.text)![0];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no email to ${to} matching ${pattern}`);
}

async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function as(browser: Browser, email: string, password?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  return page;
}

test('register, verify email and sign in', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill(ada.name);
  await page.getByLabel('Email').fill(ada.email);
  await page.getByLabel('Password').fill(ada.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const link = await mailLink(ada.email, /http:\/\/localhost:5174\/verify-email\?token=[\w-]+/);
  await page.goto(link);
  await expect(page.getByText('Your email is verified.')).toBeVisible();
  await signIn(page, ada.email, ada.password);
});

test('create and switch workspaces', async ({ page }) => {
  await signIn(page, ada.email, ada.password);
  for (const [name, slug] of [
    ['Acme Robotics', 'acme-robotics'],
    ['Side Lab', 'side-lab'],
  ]) {
    await page.goto('/workspaces/new');
    await page.getByLabel('Workspace name').fill(name);
    await page.getByLabel('URL slug').fill(slug);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  const switcher = page.getByLabel('Switch workspace');
  await switcher.selectOption({ label: 'Acme Robotics' });
  await expect(page.getByRole('heading', { name: 'Acme Robotics' })).toBeVisible();
  state.wid = /\/workspaces\/([0-9a-f-]{36})/.exec(page.url())![1];
});

test('invite and accept a workspace invitation', async ({ page, browser }) => {
  await signIn(page, ada.email, ada.password);
  await page.goto(`/workspaces/${state.wid}/members`);
  await page.getByLabel('Email').fill(users.bob.email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();

  const link = await mailLink(
    users.bob.email,
    /http:\/\/localhost:5174\/invitations\/accept\?token=[\w-]+/,
  );
  const bob = await as(browser, users.bob.email);
  await bob.goto(link);
  await bob.getByRole('button', { name: 'Join Acme Robotics' }).click();
  await expect(bob.getByRole('heading', { name: 'Acme Robotics' })).toBeVisible();
  await bob.context().close();
});

test('create a project and add a project member', async ({ page }) => {
  await signIn(page, ada.email, ada.password);
  await page.goto(`/workspaces/${state.wid}/projects/new`);
  await page.getByLabel('Name').fill('Rover Firmware');
  await page.getByLabel('Key').fill('ROV');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  state.pid = /\/projects\/([0-9a-f-]{36})/.exec(page.url())![1];

  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/members`);
  await page.getByLabel('Workspace member').selectOption({ label: users.bob.name });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel(`Project role for ${users.bob.name}`)).toBeVisible();
});

test('create and edit an issue, assigning it notifies the assignee', async ({ page }) => {
  await signIn(page, ada.email, ada.password);
  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/issues`);
  await page.getByRole('button', { name: 'New issue' }).click();
  await page.getByLabel('Title').fill('Calibrate wheel encoders');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await expect(page.getByRole('heading', { name: 'Calibrate wheel encoders' })).toBeVisible();
  state.issuePath = new URL(page.url()).pathname;

  await page.getByLabel('Title').fill('Calibrate wheel encoders (v2)');
  await page.getByLabel('Story points').fill('3');
  await page.getByLabel('Assignee').selectOption({ label: users.bob.name });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Calibrate wheel encoders (v2)' })).toBeVisible();
});

test('move the issue on the Kanban board', async ({ page }) => {
  await signIn(page, ada.email, ada.password);
  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/board`);
  const move = page.getByLabel(/^Move ROV-1 to$/);
  await move.selectOption('IN_PROGRESS');
  await expect(move).toHaveValue('IN_PROGRESS');
  await page.reload();
  await expect(page.getByLabel(/^Move ROV-1 to$/)).toHaveValue('IN_PROGRESS');
});

test('create, start and complete a sprint; reports render', async ({ page }) => {
  await signIn(page, ada.email, ada.password);
  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/sprints`);
  await page.getByLabel('Name').fill('Sprint 1');
  await page.getByRole('button', { name: 'Create sprint' }).click();
  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/backlog`);
  await page.getByLabel('Add ROV-1 to sprint').selectOption({ label: 'Sprint 1' });
  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/sprints`);
  await page.getByRole('link', { name: /Sprint 1/ }).click();
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('button', { name: 'Complete sprint…' })).toBeVisible();
  await expect(page.getByLabel('Sprint burndown chart')).toBeVisible();
  await page.getByRole('button', { name: 'Complete sprint…' }).click();
  await page.getByRole('button', { name: 'Complete sprint', exact: true }).click();
  await expect(page.getByText('Sprint summary')).toBeVisible();

  await page.goto(`/workspaces/${state.wid}/projects/${state.pid}/reports`);
  await expect(page.getByText(/Average .* over the last 1 completed sprint/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workload (open issues)' })).toBeVisible();
  await page.goto(`/workspaces/${state.wid}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('the assignee receives and reads the notification', async ({ page }) => {
  await signIn(page, users.bob.email);
  const bell = page.getByRole('link', { name: /^Notifications\s*\d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 40_000 });
  await bell.click();
  await page.getByRole('link', { name: /Ada Lovelace assigned you ROV-1/ }).click();
  await expect(page.getByRole('heading', { name: 'Calibrate wheel encoders (v2)' })).toBeVisible();
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
});

test('unauthorized: an outsider cannot open the project; a tenant user cannot reach /platform', async ({
  page,
}) => {
  await signIn(page, users.carol.email);
  await page.goto(state.issuePath!);
  await expect(
    page.getByText('This page does not exist or you no longer have access.'),
  ).toBeVisible();
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/platform\/login$/);
});

test('platform admin signs in and suspends the workspace with a reason', async ({
  page,
  browser,
}) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(users.root.email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Workspaces' }).click();
  await page.getByRole('link', { name: 'Acme Robotics' }).click();
  await page.getByRole('button', { name: 'Suspend workspace…' }).click();
  await page.getByLabel('Reason (required)').fill('E2E abuse report');
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(page.getByText('Reason: E2E abuse report')).toBeVisible();

  const owner = await as(browser, ada.email, ada.password);
  await owner.goto(`/workspaces/${state.wid}`);
  await expect(owner.getByText(/This workspace is suspended/)).toBeVisible();
  await owner.context().close();
});

test.describe('mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('issue list and detail fit the screen without horizontal scrolling', async ({ page }) => {
    await signIn(page, users.bob.email);
    for (const path of [
      `/workspaces/${state.wid}/projects/${state.pid}/issues`,
      state.issuePath!,
      '/notifications',
      '/account',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
    await page.goto('/account');
    await page.getByLabel('Theme').selectOption('dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('accessibility (axe, WCAG 2.2 A/AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`key screens have no serious or critical violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
      await signIn(page, ada.email, ada.password);
      const { default: AxeBuilder } = await import('@axe-core/playwright');
      const found: string[] = [];
      for (const path of [
        `/workspaces/${state.wid}`,
        `/workspaces/${state.wid}/projects/${state.pid}/board`,
        state.issuePath!,
        `/workspaces/${state.wid}/projects/${state.pid}/reports`,
        '/notifications',
        '/account',
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        for (const v of result.violations.filter(
          (x) => x.impact === 'serious' || x.impact === 'critical',
        )) {
          found.push(
            `${path} ${v.id}: ${v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(' '))
              .join(' | ')}`,
          );
        }
      }
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});
