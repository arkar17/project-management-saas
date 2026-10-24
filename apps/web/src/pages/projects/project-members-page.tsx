import type { ProjectMemberDto } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Badge, Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SelectField } from '../../components/ui/select';
import { canInProject } from '../../lib/permissions';
import {
  useAddProjectMember,
  useChangeProjectRole,
  useProjectMembers,
  useRemoveProjectMember,
} from '../../lib/projects';
import { useMembers } from '../../lib/workspaces';
import { useProjectContext } from './project-layout';

type Role = ProjectMemberDto['role'];
const ROLE_TEXT: Record<Role, string> = { PROJECT_MANAGER: 'Project manager', MEMBER: 'Member' };

export function ProjectMembersPage() {
  const { project, wid } = useProjectContext();
  const members = useProjectMembers(project.id);
  const manage =
    canInProject(project.myAccess, 'manageProjectSettingsAndMembers') && !project.archivedAt;

  if (members.isPending) return <Loading />;
  if (members.isError) return <ErrorState error={members.error} />;

  return (
    <div className="space-y-6">
      {manage && <AddMember pid={project.id} wid={wid} existing={members.data} />}
      <MemberRoster pid={project.id} members={members.data} manage={manage} />
      <p className="text-sm text-muted">
        Workspace Owners and Admins can access every project without being listed here.
      </p>
    </div>
  );
}

function AddMember({
  pid,
  wid,
  existing,
}: {
  pid: string;
  wid: string;
  existing: ProjectMemberDto[];
}) {
  const workspaceMembers = useMembers(wid);
  const add = useAddProjectMember(pid);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const taken = new Set(existing.map((m) => m.userId));
  const candidates = workspaceMembers.data?.filter((m) => !taken.has(m.userId)) ?? [];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    add.mutate({ userId, role }, { onSuccess: () => setUserId('') });
  }

  return (
    <Card title="Add people">
      {workspaceMembers.isPending ? (
        <Loading label="Loading workspace members…" />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted">
          Every workspace member is already on this project. Invite more people from workspace
          Members.
        </p>
      ) : (
        <form className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end" onSubmit={onSubmit}>
          <SelectField
            label="Workspace member"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Choose a person…</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Project role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="MEMBER">Member</option>
            <option value="PROJECT_MANAGER">Project manager</option>
          </SelectField>
          <Button type="submit" className="sm:w-auto" disabled={!userId || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}
      {add.isError && (
        <div className="mt-3">
          <Alert>{errorMessage(add.error)}</Alert>
        </div>
      )}
    </Card>
  );
}

function MemberRoster({
  pid,
  members,
  manage,
}: {
  pid: string;
  members: ProjectMemberDto[];
  manage: boolean;
}) {
  const changeRole = useChangeProjectRole(pid);
  const remove = useRemoveProjectMember(pid);
  const [removing, setRemoving] = useState<ProjectMemberDto | null>(null);
  const error = changeRole.error ?? remove.error;

  if (members.length === 0) return <EmptyState title="No project members yet" />;

  return (
    <Card title={`Project members (${members.length})`}>
      {error && <Alert>{errorMessage(error)}</Alert>}
      <ul className="divide-y divide-border">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
            {manage ? (
              <div className="flex items-center gap-2">
                <SelectField
                  label={`Project role for ${m.name}`}
                  hideLabel
                  className="h-9 w-40"
                  value={m.role}
                  disabled={changeRole.isPending}
                  onChange={(e) =>
                    changeRole.mutate({ memberId: m.id, role: e.target.value as Role })
                  }
                >
                  <option value="MEMBER">Member</option>
                  <option value="PROJECT_MANAGER">Project manager</option>
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
              <Badge tone={m.role === 'PROJECT_MANAGER' ? 'primary' : 'neutral'}>
                {ROLE_TEXT[m.role]}
              </Badge>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ''} from the project?`}
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })
        }
      >
        <p>
          They lose access to this project immediately. Their open issues here are unassigned;
          history is kept.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
