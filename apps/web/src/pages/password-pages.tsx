import { emailInput, passwordSchema } from '@pm/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/auth-layout';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { ApiError, api } from '../lib/api';

/** FR-AUTH-003: the response is the same whether or not the email has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const send = useMutation({
    mutationFn: (value: string) =>
      api('/auth/forgot-password', { method: 'POST', body: { email: value } }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = emailInput.safeParse({ email });
    setInvalid(!parsed.success);
    if (parsed.success) send.mutate(parsed.data.email);
  }

  return (
    <AuthLayout title="Reset your password">
      {send.isSuccess ? (
        <Alert tone="info">
          If an account exists for that email, we have sent a reset link. It expires in 1 hour.
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {invalid && <Alert>Enter a valid email address.</Alert>}
          {send.error instanceof ApiError && (
            <Alert>
              {send.error.status === 429
                ? 'Too many requests. Please wait and try again.'
                : send.error.message}
            </Alert>
          )}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-sm font-medium text-primary">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}

/** FR-AUTH-003: single-use 1-hour token; every session is signed out on success. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: (password: string) =>
      api('/auth/reset-password', { method: 'POST', body: { token, password } }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(form.password);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setError(null);
    reset.mutate(parsed.data);
  }

  const expired = !token || (reset.error instanceof ApiError && reset.error.status === 410);
  return (
    <AuthLayout title="Choose a new password">
      {reset.isSuccess ? (
        <Alert tone="info">Your password has been changed. Sign in with your new password.</Alert>
      ) : expired ? (
        <Alert>
          This reset link is invalid or has expired.{' '}
          <Link to="/forgot-password" className="font-medium underline">
            Request a new one
          </Link>
          .
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {(error ?? (reset.error instanceof ApiError ? reset.error.message : null)) && (
            <Alert>{error ?? (reset.error as ApiError).message}</Alert>
          )}
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            required
          />
          <Button type="submit" disabled={reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-sm font-medium text-primary">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
