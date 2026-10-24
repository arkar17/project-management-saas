import { loginInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/auth-layout';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { ApiError } from '../../lib/api';
import { usePlatformLogin, usePlatformMe } from '../../lib/platform';

/** FR-ADM-001: separate platform sign-in; there is no platform registration. */
export function PlatformLoginPage() {
  const me = usePlatformMe();
  const login = usePlatformLogin();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [invalid, setInvalid] = useState(false);
  if (me.data) return <Navigate to="/platform" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginInput.safeParse(form);
    setInvalid(!parsed.success);
    if (parsed.success)
      login.mutate(parsed.data, { onSuccess: () => navigate('/platform', { replace: true }) });
  }
  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <AuthLayout title="Platform administration">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {invalid && <Alert>Enter a valid email and your password.</Alert>}
        {error && (
          <Alert>
            {error.status === 401
              ? 'Email or password is incorrect, or this account is not a platform administrator.'
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
    </AuthLayout>
  );
}
