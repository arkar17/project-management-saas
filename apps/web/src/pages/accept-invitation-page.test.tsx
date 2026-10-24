import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../test-utils';
import { AcceptInvitationPage } from './accept-invitation-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = {
  invitation: {
    workspaceName: 'Acme',
    invitedBy: 'Olive',
    email: 'new@x.test',
    role: 'MEMBER',
    expiresAt: '',
  },
};
const signedOut = new Response(
  JSON.stringify({ code: 'UNAUTHENTICATED', message: 'x', requestId: '' }),
  { status: 401 },
);

describe('AcceptInvitationPage', () => {
  it('signed-out invitees see the invitation and sign-in/register options with their email', async () => {
    stubApi({ '/invitations/preview': preview, '/auth/me': signedOut });
    renderAt('/invitations/accept?token=t1', '/invitations/accept', <AcceptInvitationPage />);
    expect(await screen.findByText('Sign in to accept')).toBeTruthy();
    expect(screen.getByText(/invited/).textContent).toContain('Acme');
    expect(screen.getByText('New here? Create an account').getAttribute('href')).toBe(
      '/register?email=new%40x.test',
    );
  });

  it('inactive invitations show an explanation instead of an accept button', async () => {
    stubApi({ '/auth/me': signedOut });
    renderAt('/invitations/accept?token=bad', '/invitations/accept', <AcceptInvitationPage />);
    expect(await screen.findByText(/invalid, expired or has been revoked/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
