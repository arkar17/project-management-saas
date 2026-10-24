import { useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { useLogout, useMe } from '../lib/auth';

/** Signed-in landing page; workspace selection replaces it in G2. */
export function HomePage() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <Button
          className="w-auto"
          onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}
          disabled={logout.isPending}
        >
          Sign out
        </Button>
      </header>
      {!user.emailVerified && (
        <Alert tone="info">
          Verify {user.email} using the link we emailed you before creating or joining a workspace.
        </Alert>
      )}
    </main>
  );
}
