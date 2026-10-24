import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert } from '../components/ui/alert';
import { useMe } from '../lib/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (me.isError) {
    return (
      <div className="p-8">
        <Alert>Could not reach the server. Please retry.</Alert>
      </div>
    );
  }
  if (!me.data)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
