import { updateWorkspaceInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { canInWorkspace } from '../../lib/permissions';
import {
  useMembers,
  useTransferOwnership,
  useUpdateWorkspace,
  useWorkspace,
} from '../../lib/workspaces';
import { TimezoneSelect } from './timezone-select';

export function SettingsPage() {
  const wid = useParams().wid!;
  const workspace = useWorkspace(wid);
  if (workspace.isPending) return <Loading />;
  if (workspace.isError) return <ErrorState error={workspace.error} />;

  const ws = workspace.data;
  const canEdit = canInWorkspace(ws.myRole, 'manageWorkspaceSettingsAndInvites');
  const writable = ws.status === 'ACTIVE';

  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      {!canEdit && (
        <Alert tone="info">Only the Owner and Admins can change workspace settings.</Alert>
      )}
      {!writable && <Alert>This workspace is suspended; settings are read-only.</Alert>}
      <GeneralSettings
        key={`${ws.name}|${ws.timezone}`}
        wid={wid}
        name={ws.name}
        timezone={ws.timezone}
        disabled={!canEdit || !writable}
      />
      {canInWorkspace(ws.myRole, 'transferOwnership') && writable && (
        <TransferOwnership wid={wid} />
      )}
    </>
  );
}

function GeneralSettings({
  wid,
  name: initialName,
  timezone: initialTz,
  disabled,
}: {
  wid: string;
  name: string;
  timezone: string;
  disabled: boolean;
}) {
  const update = useUpdateWorkspace(wid);
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTz);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const changes = {
      ...(name !== initialName ? { name } : {}),
      ...(timezone !== initialTz ? { timezone } : {}),
    };
    const parsed = updateWorkspaceInput.safeParse(changes);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid settings');
    setError(null);
    update.mutate(parsed.data);
  }

  return (
    <Card title="General">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {(error || update.isError) && <Alert>{error ?? errorMessage(update.error)}</Alert>}
        {update.isSuccess && <Alert tone="info">Settings saved.</Alert>}
        <Field
          label="Workspace name"
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
        <TimezoneSelect value={timezone} onChange={setTimezone} disabled={disabled} />
        <p className="-mt-2 text-xs text-muted">
          Defines day boundaries for burndown and other reports.
        </p>
        {!disabled && (
          <Button type="submit" className="sm:w-auto" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </form>
    </Card>
  );
}

function TransferOwnership({ wid }: { wid: string }) {
  const members = useMembers(wid);
  const transfer = useTransferOwnership(wid);
  const navigate = useNavigate();
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const candidates = members.data?.filter((m) => m.role !== 'OWNER') ?? [];
  const targetName = candidates.find((m) => m.id === target)?.name;

  return (
    <Card title="Transfer ownership">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          The new Owner must have a verified email. You will become an Admin.
        </p>
        {transfer.isError && <Alert>{errorMessage(transfer.error)}</Alert>}
        {members.isPending ? (
          <Loading label="Loading members…" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted">Invite another member before transferring ownership.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <SelectField
              label="New owner"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose a member…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role.toLowerCase()})
                </option>
              ))}
            </SelectField>
            <Button
              type="button"
              className="bg-destructive sm:w-auto"
              disabled={!target}
              onClick={() => setConfirming(true)}
            >
              Transfer…
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Transfer workspace ownership?"
        confirmLabel="Transfer ownership"
        destructive
        pending={transfer.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          transfer.mutate(target, {
            onSuccess: () => navigate(`/workspaces/${wid}`),
            onSettled: () => setConfirming(false),
          })
        }
      >
        <p>{targetName} becomes the Owner. You become an Admin and cannot undo this yourself.</p>
      </ConfirmDialog>
    </Card>
  );
}
