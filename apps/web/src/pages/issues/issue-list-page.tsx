import { ISSUE_STATUSES, ISSUE_TYPES, ISSUE_PRIORITIES } from '@pm/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../../components/page-state';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { emptyIssueFilters, useIssues, useLabels, type IssueFilters } from '../../lib/issues';
import { canInProject } from '../../lib/permissions';
import { useProjectContext } from '../projects/project-layout';
import { IssueCreateForm } from './issue-create-form';
import {
  LabelChip,
  PRIORITY_LABEL,
  PriorityText,
  STATUS_LABEL,
  StatusBadge,
  TYPE_LABEL,
} from './issue-meta';

export function IssueListPage() {
  const { project, wid } = useProjectContext();
  const [filters, setFilters] = useState<IssueFilters>(emptyIssueFilters);
  const [creating, setCreating] = useState(false);
  const issues = useIssues(project.id, filters);
  const labels = useLabels(project.id);
  const canCreate = canInProject(project.myAccess, 'createIssue') && !project.archivedAt;
  const canSeeDeleted = canInProject(project.myAccess, 'softDeleteRestoreIssue');
  const set = (patch: Partial<IssueFilters>) => setFilters({ ...filters, ...patch });
  const filtered = Object.entries(filters).some(
    ([k, v]) => v !== emptyIssueFilters[k as keyof IssueFilters],
  );

  return (
    <div className="space-y-4">
      {creating ? (
        <IssueCreateForm onDone={() => setCreating(false)} />
      ) : (
        canCreate && (
          <div className="flex justify-end">
            <Button className="sm:w-auto" onClick={() => setCreating(true)}>
              New issue
            </Button>
          </div>
        )
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2">
          <Field
            label="Search"
            type="search"
            placeholder="Title or key"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>
        <SelectField
          label="Type"
          value={filters.type}
          onChange={(e) => set({ type: e.target.value })}
        >
          <option value="">All</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          <option value="">All</option>
          {ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Priority"
          value={filters.priority}
          onChange={(e) => set({ priority: e.target.value })}
        >
          <option value="">All</option>
          {ISSUE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Assignee"
          value={filters.assignee}
          onChange={(e) => set({ assignee: e.target.value })}
        >
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
        </SelectField>
        {labels.data && labels.data.length > 0 && (
          <SelectField
            label="Label"
            value={filters.labelId}
            onChange={(e) => set({ labelId: e.target.value })}
          >
            <option value="">Any label</option>
            {labels.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
        )}
        {canSeeDeleted && (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={filters.deleted}
              onChange={(e) => set({ deleted: e.target.checked })}
            />
            Deleted only
          </label>
        )}
      </div>
      {issues.isPending ? (
        <Loading />
      ) : issues.isError ? (
        <ErrorState error={issues.error} />
      ) : issues.data.issues.length === 0 ? (
        <EmptyState title={filtered ? 'No matching issues' : 'No issues yet'}>
          {!filtered && canCreate && <p>Create the first issue to start tracking work.</p>}
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {issues.data.issues.map((i) => (
              <li key={i.id}>
                <Link
                  to={`/workspaces/${wid}/projects/${project.id}/issues/${i.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:text-primary"
                >
                  <span className="w-20 shrink-0 font-mono text-sm text-muted">{i.key}</span>
                  <span className="text-xs text-muted">{TYPE_LABEL[i.type]}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
                  {i.labels.map((l) => (
                    <LabelChip key={l.id} {...l} />
                  ))}
                  <PriorityText priority={i.priority} />
                  <span className="text-sm text-muted">{i.assignee?.name ?? 'Unassigned'}</span>
                  <StatusBadge status={i.status} />
                </Link>
              </li>
            ))}
          </ul>
          {issues.data.total > issues.data.issues.length && (
            <p className="pt-3 text-sm text-muted">
              Showing {issues.data.issues.length} of {issues.data.total}. Refine the filters to
              narrow results.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
