import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  editableIssueFields,
  type Actor,
  type IssueDto,
  type IssueType,
  type UpdateIssueInput,
} from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { ApiError } from '../../lib/api';
import { emptyIssueFilters, useIssues, useUpdateIssue } from '../../lib/issues';
import { parentTypesFor } from './issue-create-form';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from './issue-meta';

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/**
 * Shows every field, but enables only the caller's allow-list (ADR-008). The loaded version
 * is sent with the patch; a 409 means someone else saved first (FR-ISS-008).
 */
export function IssueFieldsForm({
  issue,
  access,
  isOwn,
  readOnly,
  assignable,
}: {
  issue: IssueDto;
  access: Actor;
  isOwn: boolean;
  readOnly: boolean;
  assignable: { id: string; name: string }[];
}) {
  const update = useUpdateIssue(issue.id);
  const allowed = new Set(readOnly ? [] : editableIssueFields(access, isOwn));
  const initial = {
    title: issue.title,
    description: issue.description ?? '',
    status: issue.status,
    priority: issue.priority,
    type: issue.type,
    parentId: issue.parent?.id ?? '',
    assigneeId: issue.assignee?.id ?? '',
    storyPoints: issue.storyPoints === null ? '' : String(issue.storyPoints),
    dueAt: dateInput(issue.dueAt),
  };
  const [v, setV] = useState(initial);
  const parents = useIssues(
    issue.projectId,
    { ...emptyIssueFilters, type: parentTypesFor(v.type as IssueType).join(',') },
    100,
  );
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const conflict =
    update.error instanceof ApiError && update.error.body.code === 'VERSION_CONFLICT';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    const nullable = (s: string) => (s === '' ? null : s);
    if (v.title !== initial.title) patch.title = v.title;
    if (v.description !== initial.description) patch.description = nullable(v.description);
    if (v.status !== initial.status) patch.status = v.status;
    if (v.priority !== initial.priority) patch.priority = v.priority;
    if (v.type !== initial.type) patch.type = v.type;
    if (v.parentId !== initial.parentId) patch.parentId = nullable(v.parentId);
    if (v.assigneeId !== initial.assigneeId) patch.assigneeId = nullable(v.assigneeId);
    if (v.storyPoints !== initial.storyPoints)
      patch.storyPoints = v.storyPoints === '' ? null : Number(v.storyPoints);
    if (v.dueAt !== initial.dueAt)
      patch.dueAt = v.dueAt ? new Date(`${v.dueAt}T23:59:59`).toISOString() : null;
    if (Object.keys(patch).length === 0) return;
    update.mutate({ version: issue.version, ...patch } as UpdateIssueInput);
  }

  const off = (f: string) => !allowed.has(f as never);
  return (
    <Card title="Details">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {update.isError && (
          <Alert>
            {conflict
              ? 'Someone else changed this issue. The latest version is loaded underneath your edits; review and save again.'
              : errorMessage(update.error)}
          </Alert>
        )}
        <Field
          label="Title"
          value={v.title}
          disabled={off('title')}
          onChange={(e) => set({ title: e.target.value })}
        />
        <div className="space-y-1.5">
          <label htmlFor="issue-description" className="block text-sm font-medium">
            Description (Markdown)
          </label>
          <textarea
            id="issue-description"
            rows={6}
            disabled={off('description')}
            value={v.description}
            onChange={(e) => set({ description: e.target.value })}
            className="w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-sm disabled:bg-slate-50"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Status"
            value={v.status}
            disabled={off('status')}
            onChange={(e) => set({ status: e.target.value as typeof v.status })}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Priority"
            value={v.priority}
            disabled={off('priority')}
            onChange={(e) => set({ priority: e.target.value as typeof v.priority })}
          >
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Type"
            value={v.type}
            disabled={off('type')}
            onChange={(e) => set({ type: e.target.value as IssueType })}
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Parent"
            value={v.parentId}
            disabled={off('parentId')}
            onChange={(e) => set({ parentId: e.target.value })}
          >
            <option value="">None</option>
            {issue.parent && !parents.data?.issues.some((p) => p.id === issue.parent!.id) && (
              <option value={issue.parent.id}>
                {issue.parent.key} · {issue.parent.title}
              </option>
            )}
            {parents.data?.issues
              .filter((p) => p.id !== issue.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.title}
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Assignee"
            value={v.assigneeId}
            disabled={off('assigneeId')}
            onChange={(e) => set({ assigneeId: e.target.value })}
          >
            <option value="">Unassigned</option>
            {issue.assignee && !assignable.some((p) => p.id === issue.assignee!.id) && (
              <option value={issue.assignee.id}>{issue.assignee.name}</option>
            )}
            {assignable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Story points"
            type="number"
            min={0}
            max={100}
            value={v.storyPoints}
            disabled={off('storyPoints')}
            onChange={(e) => set({ storyPoints: e.target.value })}
          />
          <Field
            label="Due date"
            type="date"
            value={v.dueAt}
            disabled={off('dueAt')}
            onChange={(e) => set({ dueAt: e.target.value })}
          />
        </div>
        {allowed.size > 0 ? (
          <Button type="submit" className="sm:w-auto" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        ) : (
          <p className="text-sm text-muted">
            {readOnly ? 'This issue is read-only.' : 'You can view this issue but not edit it.'}
          </p>
        )}
      </form>
    </Card>
  );
}
