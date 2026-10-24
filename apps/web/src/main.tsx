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
import { BoardRoute } from './pages/board/board-route';
import { ProjectReportsPage } from './pages/projects/project-reports-page';
import { PlatformLoginPage } from './pages/platform/platform-login-page';
import {
  PlatformAuditPage,
  PlatformDashboardPage,
  PlatformUsersPage,
  PlatformWorkspaceDetailPage,
  PlatformWorkspacesPage,
} from './pages/platform/platform-pages';
import { PlatformShell } from './pages/platform/platform-shell';
import { AccountPage } from './pages/account-page';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/password-pages';
import { NotificationsPage } from './pages/notifications/notifications-page';
import { BacklogPage } from './pages/sprints/backlog-page';
import { SprintDetailPage } from './pages/sprints/sprint-detail-page';
import { SprintsPage } from './pages/sprints/sprints-page';
import { IssueDetailPage } from './pages/issues/issue-detail-page';
import { IssueListPage } from './pages/issues/issue-list-page';
import { CreateProjectPage } from './pages/projects/create-project-page';
import { ProjectLayout } from './pages/projects/project-layout';
import { ProjectListPage } from './pages/projects/project-list-page';
import { ProjectMembersPage } from './pages/projects/project-members-page';
import { ProjectOverviewPage } from './pages/projects/project-overview-page';
import { ProjectSettingsPage } from './pages/projects/project-settings-page';
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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
          <Route path="/platform/login" element={<PlatformLoginPage />} />
          <Route path="/platform" element={<PlatformShell />}>
            <Route index element={<PlatformDashboardPage />} />
            <Route path="workspaces" element={<PlatformWorkspacesPage />} />
            <Route path="workspaces/:wid" element={<PlatformWorkspaceDetailPage />} />
            <Route path="users" element={<PlatformUsersPage />} />
            <Route path="audit" element={<PlatformAuditPage />} />
          </Route>
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<WorkspaceIndexPage />} />
            <Route path="/workspaces/new" element={<CreateWorkspacePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/workspaces/:wid" element={<WorkspaceOverviewPage />} />
            <Route path="/workspaces/:wid/members" element={<MembersPage />} />
            <Route path="/workspaces/:wid/settings" element={<SettingsPage />} />
            <Route path="/workspaces/:wid/projects" element={<ProjectListPage />} />
            <Route path="/workspaces/:wid/projects/new" element={<CreateProjectPage />} />
            <Route path="/workspaces/:wid/projects/:pid" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="board" element={<BoardRoute />} />
              <Route path="backlog" element={<BacklogPage />} />
              <Route path="sprints" element={<SprintsPage />} />
              <Route path="sprints/:sid" element={<SprintDetailPage />} />
              <Route path="issues" element={<IssueListPage />} />
              <Route path="reports" element={<ProjectReportsPage />} />
              <Route path="issues/:iid" element={<IssueDetailPage />} />
              <Route path="members" element={<ProjectMembersPage />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
