import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTORS,
  CAPABILITIES,
  type Capability,
  type Grant,
  can,
  editableIssueFields,
  grantFor,
  tenantActor,
} from './permissions.js';

const csvPath = fileURLToPath(
  new URL('../../../docs/baseline-v3/PERMISSION_MATRIX_v3.csv', import.meta.url),
);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else cell += ch;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

const LABELS: Record<string, Capability> = {
  'Transfer workspace ownership': 'transferOwnership',
  'Workspace settings and invites': 'manageWorkspaceSettingsAndInvites',
  'Create / archive / unarchive projects': 'manageProjectLifecycle',
  'Project settings / membership': 'manageProjectSettingsAndMembers',
  'Create issue': 'createIssue',
  'Edit any project issue': 'editAnyIssue',
  'Edit own assigned / reported issue': 'editOwnIssue',
  'Manage sprint / backlog': 'manageSprintsAndBacklog',
  'Change status of own assigned/reported issue (form or board)': 'changeOwnIssueStatus',
  'Comment / attach on visible issue': 'commentAndAttach',
  'Read project reports': 'readProjectReports',
  'Change member roles / remove workspace members': 'manageWorkspaceMembers',
  'Reorder backlog / board ranking': 'reorderRanking',
  'Manage project labels': 'manageLabels',
  'Soft-delete / restore issue': 'softDeleteRestoreIssue',
  "Remove (moderate) others' comments": 'moderateComments',
  'Watch / unwatch visible issue': 'watchIssue',
  'View workspace member list': 'viewMemberList',
  'Delete issue permanently': 'deleteIssuePermanently',
  '◆ Remove / demote the Owner': 'removeOrDemoteOwner',
  '◆ Grant workspace privileges': 'grantWorkspacePrivileges',
  '◆ Edit (≤ 15 min) / delete own comment': 'editDeleteOwnComment',
  '◆ Workspace overview dashboard': 'viewWorkspaceOverview',
  '◆ Read tenant content (issues / comments / files)': 'readTenantContent',
  '◆ Tenant metadata, platform metrics': 'readPlatformMetadata',
  '◆ Suspend / reactivate workspace': 'suspendWorkspace',
};

function normalise(cell: string): Grant {
  const v = cell.trim().replace('¹', '');
  const map: Record<string, Grant> = {
    Y: 'Y',
    N: 'N',
    Own: 'OWN',
    'Not Owner': 'NOT_OWNER',
    Names: 'NAMES',
    Scoped: 'SCOPED',
  };
  const grant = map[v];
  if (!grant) throw new Error(`Unknown matrix value "${cell}"`);
  return grant;
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const blank = rows.findIndex((r) => r.every((c) => c.trim() === ''));
const capabilityRows = rows.slice(1, blank);
const fieldRows = rows.slice(blank + 2).filter((r) => r[0]?.trim());

describe('PERMISSION_MATRIX_v3.csv ↔ shared policy', () => {
  it('covers every capability row exactly once', () => {
    const labels = capabilityRows.map((r) => r[0]!);
    expect(labels.map((l) => LABELS[l])).not.toContain(undefined);
    expect(new Set(labels.map((l) => LABELS[l]))).toEqual(new Set(Object.keys(CAPABILITIES)));
  });

  it.each(capabilityRows.map((r) => [r[0]!, r] as const))('%s', (label, row) => {
    const capability = LABELS[label]!;
    ACTORS.forEach((actor, i) => {
      expect(grantFor(actor, capability), `${actor}`).toBe(normalise(row[i + 1]!));
    });
  });

  it('issue field allow-list matches the field section', () => {
    for (const row of fieldRows) {
      const fields = row[0]!.split(',').map((f) => f.trim().split(' ')[0]!);
      const [anyIssue, memberOwn, memberOther] = [row[1], row[2], row[3]].map((c) => c?.trim());
      for (const field of fields) {
        if (field === 'comment') continue; // not an issue field; covered by commentAndAttach
        expect(editableIssueFields('PROJECT_MANAGER', false).includes(field as never), field).toBe(
          anyIssue === 'Y',
        );
        expect(editableIssueFields('PROJECT_MEMBER', true).includes(field as never), field).toBe(
          memberOwn === 'Y',
        );
        expect(editableIssueFields('PROJECT_MEMBER', false).includes(field as never), field).toBe(
          memberOther === 'Y',
        );
      }
    }
  });
});

describe('role resolution and conditional grants', () => {
  it('Owner/Admin get implicit project access; no project row means WORKSPACE_MEMBER', () => {
    expect(tenantActor('OWNER', null)).toBe('OWNER');
    expect(tenantActor('ADMIN', 'MEMBER')).toBe('ADMIN');
    expect(tenantActor('MEMBER', 'PROJECT_MANAGER')).toBe('PROJECT_MANAGER');
    expect(tenantActor('MEMBER', 'MEMBER')).toBe('PROJECT_MEMBER');
    expect(tenantActor('MEMBER', null)).toBe('WORKSPACE_MEMBER');
  });

  it('OWN requires ownership and NOT_OWNER requires a non-Owner target', () => {
    expect(can('PROJECT_MEMBER', 'editOwnIssue', { isOwn: true })).toBe(true);
    expect(can('PROJECT_MEMBER', 'editOwnIssue', { isOwn: false })).toBe(false);
    expect(can('PROJECT_MEMBER', 'editOwnIssue')).toBe(false);
    expect(can('ADMIN', 'manageWorkspaceMembers', { targetIsOwner: true })).toBe(false);
    expect(can('ADMIN', 'manageWorkspaceMembers', { targetIsOwner: false })).toBe(true);
    expect(can('PLATFORM_ADMIN', 'readTenantContent')).toBe(false);
  });
});
