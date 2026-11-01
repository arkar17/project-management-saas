import { cleanup, screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { ProjectLayout } from './project-layout';
import { ProjectListPage } from './project-list-page';
import { ProjectSettingsPage } from './project-settings-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const project = (myAccess: string, archivedAt: string | null = null) => ({
  project: {
    id: pid,
    workspaceId: wid,
    key: 'WEB',
    name: 'Website',
    description: null,
    status: 'ACTIVE',
    startDate: null,
    targetDate: null,
    archivedAt,
    createdAt: '',
    myAccess,
  },
});
const workspace = (myRole: string) => ({
  workspace: {
    id: wid,
    name: 'Acme',
    slug: 'acme',
    timezone: 'UTC',
    status: 'ACTIVE',
    myRole,
    memberCount: 1,
    projectCount: 0,
    createdAt: '',
  },
});

function renderSettings() {
  return renderAt(
    `/workspaces/${wid}/projects/${pid}/settings`,
    '/workspaces/:wid/projects/:pid',
    <ProjectLayout />,
    <Route path="settings" element={<ProjectSettingsPage />} />,
  );
}

describe('project UI permissions', () => {
  it('Members see an empty state and no create button', async () => {
    stubApi({
      [`/workspaces/${wid}`]: workspace('MEMBER'),
      [`/workspaces/${wid}/projects`]: { projects: [], total: 0, page: 1, pageSize: 100 },
    });
    renderAt(`/workspaces/${wid}/projects`, '/workspaces/:wid/projects', <ProjectListPage />);
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    expect(screen.queryByText('New project')).toBeNull();
  });

  it('PMs can edit settings but cannot archive; key is read-only', async () => {
    stubApi({ [`/projects/${pid}`]: project('PROJECT_MANAGER') });
    renderSettings();
    expect(await screen.findByText('Save changes')).toBeTruthy();
    expect(screen.queryByText('Archive…')).toBeNull();
    expect((screen.getByLabelText('Key') as HTMLInputElement).disabled).toBe(true);
  });

  it('archived projects are read-only, with unarchive offered to Admins', async () => {
    stubApi({ [`/projects/${pid}`]: project('ADMIN', '2026-10-24T00:00:00Z') });
    renderSettings();
    expect(await screen.findByText(/archived and read-only/)).toBeTruthy();
    expect(screen.getByText('Unarchive…')).toBeTruthy();
    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('project under the wrong workspace URL shows not-found', async () => {
    stubApi({
      [`/projects/${pid}`]: {
        project: {
          ...project('ADMIN').project,
          workspaceId: '33333333-3333-4333-8333-333333333333',
        },
      },
    });
    renderSettings();
    expect(await screen.findByText(/no longer have access/)).toBeTruthy();
  });
});
