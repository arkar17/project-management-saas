import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../test-utils';
import { AccountPage } from './account-page';
import { ForgotPasswordPage, ResetPasswordPage } from './password-pages';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@x.test',
  name: 'Ada',
  timezone: 'UTC',
  emailVerified: true,
};

describe('FR-AUTH-003/004 screens', () => {
  it('forgot password shows the same neutral confirmation', async () => {
    stubApi({
      '/auth/csrf': { csrfToken: 't' },
      '/auth/forgot-password': new Response(null, { status: 202 }),
    });
    renderAt('/forgot-password', '/forgot-password', <ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@x.test' } });
    fireEvent.click(screen.getByText('Send reset link'));
    expect(await screen.findByText(/If an account exists for that email/)).toBeTruthy();
  });

  it('reset password validates locally and handles expired links', async () => {
    stubApi({
      '/auth/csrf': { csrfToken: 't' },
      '/auth/reset-password': json(410, {
        code: 'TOKEN_EXPIRED',
        message: 'expired',
        requestId: '',
      }),
    });
    renderAt('/reset-password?token=abc', '/reset-password', <ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'long-enough-pass' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different-pass1' },
    });
    fireEvent.click(screen.getByText('Set new password'));
    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'long-enough-pass' },
    });
    fireEvent.click(screen.getByText('Set new password'));
    expect(await screen.findByText(/invalid or has expired/)).toBeTruthy();
    cleanup();
    renderAt('/reset-password', '/reset-password', <ResetPasswordPage />);
    expect(screen.getByText(/invalid or has expired/)).toBeTruthy();
  });

  it('account page saves the profile and explains the Owner block on deactivation', async () => {
    const fetchMock = stubApi({
      '/auth/me': { user },
      '/auth/csrf': { csrfToken: 't' },
      '/users/me/preferences': { user: { ...user, name: 'Ada L.' } },
      '/users/me/deactivate': json(409, { code: 'OWNER_PROTECTED', message: 'x', requestId: '' }),
    });
    renderAt('/account', '/account', <AccountPage />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Ada L.' } });
    fireEvent.click(screen.getByText('Save profile'));
    expect(await screen.findByText('Profile saved.')).toBeTruthy();
    const patch = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/users/me/preferences'))!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ name: 'Ada L.', timezone: 'UTC' });

    fireEvent.click(screen.getByText('Deactivate account…'));
    fireEvent.change(screen.getByLabelText('Confirm with your password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByText('Deactivate', { selector: 'button' }));
    await waitFor(() => expect(screen.getByText(/You own a workspace/)).toBeTruthy());
  });
});
