import { registerInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/auth-layout';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { ApiError } from '../lib/api';
import { fieldErrors, useRegister } from '../lib/auth';

export function RegisterPage() {
  const register = useRegister();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = registerInput.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    register.mutate(parsed.data, { onError: (err) => setErrors(fieldErrors(err)) });
  }

  if (register.isSuccess) {
    // Account-neutral (FR-AUTH-001): the same message whether or not the email was new.
    return (
      <AuthLayout title="Check your email">
        <Alert tone="info">
          If {form.email} can be registered, we have sent a verification link. It expires in 24
          hours.
        </Alert>
        <Link to="/login" className="block text-center text-sm font-medium text-primary">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  const error =
    register.error instanceof ApiError && register.error.status !== 422 ? register.error : null;

  return (
    <AuthLayout title="Create your account">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert>
            {error.status === 429 ? 'Too many attempts. Please wait and try again.' : error.message}
          </Alert>
        )}
        <Field
          label="Name"
          autoComplete="name"
          value={form.name}
          error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          error={errors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <Button type="submit" disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
