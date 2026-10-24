import { passwordSchema, type AuthUserDto } from '@pm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, errorMessage } from '../components/page-state';
import { ThemeSelect } from '../components/theme-select';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Field } from '../components/ui/field';
import { ApiError, api } from '../lib/api';
import { meQueryKey, useMe } from '../lib/auth';
import { TimezoneSelect } from './workspaces/timezone-select';

/** FR-AUTH-004: profile and timezone, password change, self-deactivation. */
export function AccountPage() {
  const me = useMe();
  if (!me.data) return <Loading />;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <Profile key={me.data.id + me.data.name + me.data.timezone} user={me.data} />
      <Card title="Appearance">
        <div className="max-w-xs">
          <ThemeSelect />
        </div>
        <p className="mt-2 text-sm text-muted">
          Saved in this browser. System follows your device.
        </p>
      </Card>
      <ChangePassword />
      <Deactivate />
    </div>
  );
}

function Profile({ user }: { user: AuthUserDto }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: user.name, timezone: user.timezone });
  const save = useMutation({
    mutationFn: () =>
      api<{ user: AuthUserDto }>('/users/me/preferences', { method: 'PATCH', body: form }),
    onSuccess: ({ user: next }) => qc.setQueryData(meQueryKey, next),
  });
  return (
    <Card title="Profile">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) save.mutate();
        }}
      >
        {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="info">Profile saved.</Alert>}
        <Field label="Email" value={user.email} disabled readOnly />
        <Field
          label="Name"
          value={form.name}
          maxLength={100}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <TimezoneSelect
          label="Your timezone"
          value={form.timezone}
          onChange={(timezone) => setForm({ ...form, timezone })}
        />
        <Button type="submit" className="sm:w-auto" disabled={save.isPending || !form.name.trim()}>
          {save.isPending ? 'Saving…' : 'Save profile'}
        </Button>
      </form>
    </Card>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api('/users/me/password', { method: 'POST', body: form }),
    onSuccess: () => setForm({ currentPassword: '', newPassword: '' }),
  });
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(form.newPassword);
    setError(parsed.success ? null : parsed.error.issues[0]!.message);
    if (parsed.success && form.currentPassword) change.mutate();
  }
  return (
    <Card title="Password">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {(error ?? (change.isError ? errorMessage(change.error) : null)) && (
          <Alert>{error ?? errorMessage(change.error)}</Alert>
        )}
        {change.isSuccess && (
          <Alert tone="info">Password changed. Your other sessions were signed out.</Alert>
        )}
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
        <Button type="submit" className="sm:w-auto" disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function Deactivate() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const deactivate = useMutation({
    mutationFn: () => api('/users/me/deactivate', { method: 'POST', body: { password } }),
    onSuccess: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
  const owner =
    deactivate.error instanceof ApiError && deactivate.error.body.code === 'OWNER_PROTECTED';
  return (
    <Card title="Deactivate account">
      <p className="text-sm text-slate-700">
        You will be removed from every workspace and signed out everywhere. Your comments and
        history stay visible to others. Owners must transfer ownership first.
      </p>
      {deactivate.isError && (
        <Alert>
          {owner
            ? 'You own a workspace. Transfer ownership before deactivating your account.'
            : errorMessage(deactivate.error)}
        </Alert>
      )}
      <Button className="mt-3 bg-destructive sm:w-auto" onClick={() => setOpen(true)}>
        Deactivate account…
      </Button>
      <ConfirmDialog
        open={open}
        title="Deactivate your account?"
        confirmLabel="Deactivate"
        destructive
        pending={deactivate.isPending}
        onCancel={() => {
          setOpen(false);
          setPassword('');
        }}
        onConfirm={() => {
          if (!password) return;
          deactivate.mutate(undefined, {
            onSettled: () => {
              setOpen(false);
              setPassword('');
            },
          });
        }}
      >
        <p>This cannot be undone from the app.</p>
        <Field
          label="Confirm with your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}
