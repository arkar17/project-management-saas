import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/alert';
import { usePlatformLogout, usePlatformMe } from '../../lib/platform';

const sections = [
  { to: '/platform', label: 'Dashboard', end: true },
  { to: '/platform/workspaces', label: 'Workspaces', end: false },
  { to: '/platform/users', label: 'Users', end: false },
  { to: '/platform/audit', label: 'Audit log', end: false },
];

/** Platform chrome, guarded by the PLATFORM session; the API re-checks every request. */
export function PlatformShell() {
  const me = usePlatformMe();
  const logout = usePlatformLogout();
  const navigate = useNavigate();
  if (me.isPending) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (me.isError)
    return (
      <div className="p-8">
        <Alert>Could not reach the server. Please retry.</Alert>
      </div>
    );
  if (!me.data) return <Navigate to="/platform/login" replace />;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-semibold">PM SaaS · Platform</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden opacity-80 sm:inline">{me.data.name}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium hover:bg-white/10"
              onClick={() =>
                logout.mutate(undefined, { onSettled: () => navigate('/platform/login') })
              }
            >
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Platform" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-white' : 'border-transparent opacity-75 hover:opacity-100'}`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
