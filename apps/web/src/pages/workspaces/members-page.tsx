import { inviteInput, type MemberDto } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Badge, Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { useMe } from '../../lib/auth';
import { canInWorkspace } from '../../lib/permissions';
import {
  useChangeRole,
  useInvitations,
  useInvite,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  useWorkspace,
} from '../../lib/workspaces';

export function MembersPage() {
  const wid = useParams().wid!;
  const workspace = useWorkspace(wid);
  const members = useMembers(wid);
  const role = workspace.data?.myRole;
  const manager = canInWorkspace(role, 'manageWorkspaceSettingsAndInvites');
  const writable = workspace.data?.status === 'ACTIVE';

  if (workspace.isPending || members.isPending) return <Loading />;
  if (workspace.isError) return <ErrorState error={workspace.error} />;
  if (members.isError) return <ErrorState error={members.error} />;

  return (
    <>
      <h1 className="text-2xl font-semibold">Members</h1>
      {manager && writable && <InviteForm wid={wid} />}
      <MemberList wid={wid} members={members.data} role={role!} writable={writable} />
      {manager && <PendingInvitations wid={wid} writable={writable} />}
    </>
  );
}

function InviteForm({ wid }: { wid: string }) {
  const invite = useInvite(wid);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [invalid, setInvalid] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = inviteInput.safeParse({ email, role });
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    invite.mutate(parsed.data, {
      onSuccess: () => {
        setSentTo(parsed.data.email);
        setEmail('');
      },
    });
  }

  return (
    <Card title="Invite people">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        onSubmit={onSubmit}
        noValidate
      >
        <Field
          label="Email"
          type="email"
          value={email}
          error={invalid ? 'Enter a valid email address' : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        <SelectField
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as 'MEMBER' | 'ADMIN')}
        >
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </SelectField>
        <Button type="submit" className="sm:w-auto" disabled={invite.isPending}>
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
      <div className="mt-3 space-y-2" aria-live="polite">
        {invite.isError && <Alert>{errorMessage(invite.error)}</Alert>}
        {sentTo && invite.isSuccess && (
          <Alert tone="info">Invitation sent to {sentTo}. It expires in 7 days.</Alert>
        )}
      </div>
    </Card>
  );
}

function MemberList({
  wid,
  members,
  role,
  writable,
}: {
  wid: string;
  members: MemberDto[];
  role: MemberDto['role'];
  writable: boolean;
}) {
  const { data: me } = useMe();
  const changeRole = useChangeRole(wid);
  const remove = useRemoveMember(wid);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const error = changeRole.error ?? remove.error;

  return (
    <Card title={`People (${members.length})`}>
      {error && (
        <div className="mb-3">
          <Alert>{errorMessage(error)}</Alert>
        </div>
      )}
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const manageable =
            writable &&
            m.role !== 'OWNER' &&
            canInWorkspace(role, 'manageWorkspaceMembers', { targetIsOwner: false });
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.name}
                  {m.userId === me?.id && <span className="text-muted"> (you)</span>}
                </p>
                {m.email && <p className="truncate text-sm text-muted">{m.email}</p>}
              </div>
              {manageable ? (
                <div className="flex items-center gap-2">
                  <SelectField
                    label={`Role for ${m.name}`}
                    hideLabel
                    className="h-9 w-28"
                    value={m.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate({
                        memberId: m.id,
                        role: e.target.value as 'ADMIN' | 'MEMBER',
                      })
                    }
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </SelectField>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm font-medium text-destructive hover:bg-red-50"
                    onClick={() => setRemoving(m)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <Badge tone={m.role === 'OWNER' ? 'primary' : 'neutral'}>
                  {m.role.toLowerCase()}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ''}?`}
        confirmLabel="Remove member"
        destructive
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })
        }
      >
        <p>They lose access to this workspace and all its projects immediately.</p>
        <p>Their open issues are unassigned. Comments and history are kept.</p>
      </ConfirmDialog>
    </Card>
  );
}

function PendingInvitations({ wid, writable }: { wid: string; writable: boolean }) {
  const invitations = useInvitations(wid, true);
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();

  if (invitations.isPending) return <Loading label="Loading invitations…" />;
  if (invitations.isError) return <ErrorState error={invitations.error} />;
  if (invitations.data.length === 0) return <EmptyState title="No pending invitations" />;

  return (
    <Card title="Pending invitations">
      {(resend.error ?? revoke.error) && (
        <Alert>{errorMessage(resend.error ?? revoke.error)}</Alert>
      )}
      <ul className="divide-y divide-border">
        {invitations.data.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{inv.email}</p>
              <p className="text-sm text-muted">
                {inv.role.toLowerCase()} · invited by {inv.invitedBy} · expires{' '}
                {new Date(inv.expiresAt).toLocaleDateString()}
              </p>
            </div>
            {writable && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-indigo-50"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(inv.id)}
                >
                  Resend
                </button>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm font-medium text-destructive hover:bg-red-50"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(inv.id)}
                >
                  Revoke
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
