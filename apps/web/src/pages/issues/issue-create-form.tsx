import {
  ALLOWED_CHILDREN,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  createIssueInput,
  type IssueType,
} from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { useMe } from '../../lib/auth';
import { emptyIssueFilters, useCreateIssue, useIssues, useLabels } from '../../lib/issues';
import { issuesToErrors } from '../projects/project-form-fields';
import { useProjectContext } from '../projects/project-layout';
import { PRIORITY_LABEL, TYPE_LABEL } from './issue-meta';
import { useAssignable } from './use-assignable';

export const parentTypesFor = (type: IssueType) =>
  ISSUE_TYPES.filter((p) => ALLOWED_CHILDREN[p].includes(type));

/** ADR-008: Members choose type/title/description/due/parent/labels; assignee self or none. */
export function IssueCreateForm({ onDone }: { onDone: () => void }) {
  const { project, wid } = useProjectContext();
  const { data: me } = useMe();
  const isMember = project.myAccess === 'PROJECT_MEMBER';
  const create = useCreateIssue(project.id);
  const navigate = useNavigate();
  const labels = useLabels(project.id);
  const assignable = useAssignable(wid, project.id);
  const [type, setType] = useState<IssueType>('TASK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [assigneeId, setAssigneeId] = useState('');
  const [parentId, setParentId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const parentTypes = parentTypesFor(type);
  const parents = useIssues(project.id, { ...emptyIssueFilters, type: parentTypes.join(',') }, 100);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createIssueInput.safeParse({
      type,
      title,
      description: description || null,
      assigneeId: assigneeId || null,
      parentId: parentId || null,
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
      labelIds,
      ...(isMember ? {} : { priority }),
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (issue) => {
        onDone();
        navigate(`/workspaces/${wid}/projects/${project.id}/issues/${issue.id}`);
      },
    });
  }

  return (
    <Card title="New issue">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
        {create.isError && (
          <div className="sm:col-span-2">
            <Alert>{errorMessage(create.error)}</Alert>
          </div>
        )}
        <SelectField
          label="Type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as IssueType);
            setParentId('');
          }}
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={type === 'SUBTASK' ? 'Parent (required)' : 'Parent'}
          value={parentId}
          disabled={parentTypes.length === 0}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">
            {parentTypes.length === 0 ? 'Not allowed for this type' : 'None'}
          </option>
          {parents.data?.issues.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.title}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <Field
            label="Title"
            value={title}
            error={errors.title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="new-issue-description" className="block text-sm font-medium">
            Description (Markdown)
          </label>
          <textarea
            id="new-issue-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
        </div>
        <SelectField
          label="Assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {(isMember ? assignable.filter((p) => p.id === me?.id) : assignable).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === me?.id ? ' (me)' : ''}
            </option>
          ))}
        </SelectField>
        {isMember ? (
          <p className="self-end text-sm text-muted">
            Priority starts at Medium; a project manager can change it.
          </p>
        ) : (
          <SelectField
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          label="Due date"
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        {labels.data && labels.data.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Labels</legend>
            <div className="flex flex-wrap gap-3">
              {labels.data.map((l) => (
                <label key={l.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={labelIds.includes(l.id)}
                    onChange={(e) =>
                      setLabelIds(
                        e.target.checked ? [...labelIds, l.id] : labelIds.filter((x) => x !== l.id),
                      )
                    }
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" className="sm:w-auto" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create issue'}
          </Button>
          <Button
            type="button"
            className="bg-white text-slate-900 ring-1 ring-border sm:w-auto"
            onClick={onDone}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
