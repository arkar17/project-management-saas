import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useLogout, useMe } from '../lib/auth';
import { useUnreadCount } from '../lib/notifications';
import { lastWorkspace, useWorkspaces } from '../lib/workspaces';
import { Alert } from './ui/alert';

/** Signed-in chrome: workspace switcher, section nav and account actions. */
export function AppShell() {
  const { wid } = useParams();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const workspaces = useWorkspaces();
  const logout = useLogout();
  const unread = useUnreadCount(user?.emailVerified === true);

  const sections = wid
    ? [
        { to: `/workspaces/${wid}`, label: 'Overview', end: true },
        { to: `/workspaces/${wid}/projects`, label: 'Projects', end: false },
        { to: `/workspaces/${wid}/members`, label: 'Members', end: false },
        { to: `/workspaces/${wid}/settings`, label: 'Settings', end: false },
      ]
    : [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <NavLink to="/" className="text-lg font-semibold tracking-tight">
            PM SaaS
          </NavLink>
          {workspaces.data && workspaces.data.length > 0 && (
            <>
              <label htmlFor="workspace-switcher" className="sr-only">
                Switch workspace
              </label>
              <select
                id="workspace-switcher"
                className="h-9 max-w-[12rem] rounded-md border border-border bg-white px-2 text-sm"
                value={wid ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new') return navigate('/workspaces/new');
                  lastWorkspace.set(e.target.value);
                  navigate(`/workspaces/${e.target.value}`);
                }}
              >
                {!wid && <option value="">Select workspace…</option>}
                {workspaces.data.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
                <option value="__new">+ New workspace</option>
              </select>
            </>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <NavLink
              to="/notifications"
              className="relative rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
              aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`}
            >
              Notifications
              {!!unread.data && (
                <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                  {unread.data > 99 ? '99+' : unread.data}
                </span>
              )}
            </NavLink>
            <span className="hidden text-muted sm:inline">{user?.name}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium text-primary hover:bg-indigo-50"
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}
            >
              Sign out
            </button>
          </div>
        </div>
        {sections.length > 0 && (
          <nav aria-label="Workspace" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
            {sections.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                end={s.end}
                className={({ isActive }) =>
                  `border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-slate-900'}`
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {user && !user.emailVerified && (
          <Alert tone="info">
            Verify {user.email} using the link we emailed you before creating or joining a
            workspace.
          </Alert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
