import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { AppShell } from './components/app-shell';
import { AcceptInvitationPage } from './pages/accept-invitation-page';
import { LoginPage } from './pages/login-page';
import { RegisterPage } from './pages/register-page';
import { VerifyEmailPage } from './pages/verify-email-page';
import { CreateWorkspacePage } from './pages/workspaces/create-workspace-page';
import { MembersPage } from './pages/workspaces/members-page';
import { SettingsPage } from './pages/workspaces/settings-page';
import { WorkspaceIndexPage } from './pages/workspaces/workspace-index-page';
import { WorkspaceOverviewPage } from './pages/workspaces/workspace-overview-page';
import { RequireAuth } from './routes/require-auth';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<WorkspaceIndexPage />} />
            <Route path="/workspaces/new" element={<CreateWorkspacePage />} />
            <Route path="/workspaces/:wid" element={<WorkspaceOverviewPage />} />
            <Route path="/workspaces/:wid/members" element={<MembersPage />} />
            <Route path="/workspaces/:wid/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
