import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/auth-layout';
import { Alert } from '../components/ui/alert';
import { api } from '../lib/api';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const verify = useMutation({
    mutationFn: (t: string) => api('/auth/verify-email', { method: 'POST', body: { token: t } }),
  });
  const { mutate } = verify;

  useEffect(() => {
    if (token) mutate(token);
  }, [token, mutate]);

  return (
    <AuthLayout title="Verify email">
      {!token || verify.isError ? (
        <Alert>This verification link is invalid or has expired.</Alert>
      ) : verify.isSuccess ? (
        <Alert tone="info">Your email is verified.</Alert>
      ) : (
        <p className="text-sm text-muted">Verifying…</p>
      )}
      <Link to="/login" className="block text-center text-sm font-medium text-primary">
        Continue to sign in
      </Link>
    </AuthLayout>
  );
}
