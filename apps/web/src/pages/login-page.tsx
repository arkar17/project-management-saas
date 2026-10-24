import { loginInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/auth-layout';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { ApiError } from '../lib/api';
import { useLogin, useMe } from '../lib/auth';
import { pendingInvite } from '../lib/workspaces';

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [invalid, setInvalid] = useState(false);

  if (me.data) return <Navigate to="/" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginInput.safeParse(form);
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    login.mutate(parsed.data, {
      onSuccess: () => {
        const from = (location.state as { from?: string } | null)?.from;
        // An invitation opened before registering/verifying resumes after sign-in.
        const invite = pendingInvite.get();
        const resume = invite ? `/invitations/accept?token=${encodeURIComponent(invite)}` : '/';
        navigate(from ?? resume, { replace: true });
      },
    });
  }

  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <AuthLayout title="Sign in">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {invalid && <Alert>Enter a valid email and your password.</Alert>}
        {error && (
          <Alert>
            {error.status === 401
              ? 'Email or password is incorrect.'
              : error.status === 429
                ? 'Too many attempts. Please wait and try again.'
                : error.message}
          </Alert>
        )}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        No account?{' '}
        <Link
          to="/register"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}
