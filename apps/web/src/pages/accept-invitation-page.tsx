import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/auth-layout';
import { Loading, errorMessage } from '../components/page-state';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import {
  lastWorkspace,
  pendingInvite,
  useAcceptInvitation,
  useInvitationPreview,
} from '../lib/workspaces';

export function AcceptInvitationPage() {
  const token = useSearchParams()[0].get('token');
  const me = useMe();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) pendingInvite.set(token);
  }, [token]);

  const here = `/invitations/accept?token=${encodeURIComponent(token ?? '')}`;

  let body;
  if (!token || preview.isError) {
    body = (
      <Alert>This invitation is invalid, expired or has been revoked. Ask for a new one.</Alert>
    );
  } else if (preview.isPending || me.isPending) {
    body = <Loading />;
  } else {
    const inv = preview.data;
    const mismatch =
      accept.error instanceof ApiError && accept.error.body.code === 'INVITATION_EMAIL_MISMATCH';
    body = (
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          <strong>{inv.invitedBy}</strong> invited <strong>{inv.email}</strong> to join{' '}
          <strong>{inv.workspaceName}</strong> as {inv.role === 'ADMIN' ? 'an admin' : 'a member'}.
        </p>
        {accept.isError && (
          <Alert>
            {mismatch
              ? `You are signed in as ${me.data?.email}. Sign in as ${inv.email} to accept.`
              : errorMessage(accept.error)}
          </Alert>
        )}
        {!me.data ? (
          <div className="space-y-2">
            <Link
              to="/login"
              state={{ from: here }}
              className="flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
            >
              Sign in to accept
            </Link>
            <Link
              to={`/register?email=${encodeURIComponent(inv.email)}`}
              className="block text-center text-sm font-medium text-primary"
            >
              New here? Create an account
            </Link>
          </div>
        ) : !me.data.emailVerified ? (
          <Alert tone="info">Verify {me.data.email} first, then reopen this link.</Alert>
        ) : (
          <Button
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate(token, {
                onSuccess: ({ workspaceId }) => {
                  pendingInvite.clear();
                  lastWorkspace.set(workspaceId);
                  navigate(`/workspaces/${workspaceId}`, { replace: true });
                },
              })
            }
          >
            {accept.isPending ? 'Joining…' : `Join ${inv.workspaceName}`}
          </Button>
        )}
      </div>
    );
  }

  return <AuthLayout title="Workspace invitation">{body}</AuthLayout>;
}
