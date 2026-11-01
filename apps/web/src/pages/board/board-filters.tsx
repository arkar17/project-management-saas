import { ISSUE_PRIORITIES, ISSUE_TYPES } from '@pm/shared';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { useLabels } from '../../lib/issues';
import type { BoardFilters } from '../../lib/sprints';
import { PRIORITY_LABEL, TYPE_LABEL } from '../issues/issue-meta';

/** Shared by the board and the backlog (FR-BRD-004). */
export function BoardFilterBar({
  pid,
  value,
  onChange,
}: {
  pid: string;
  value: BoardFilters;
  onChange: (f: BoardFilters) => void;
}) {
  const labels = useLabels(pid);
  const set = (patch: Partial<BoardFilters>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div className="col-span-2 md:col-span-1">
        <Field
          label="Search"
          type="search"
          placeholder="Title or key"
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>
      <SelectField
        label="Assignee"
        value={value.assignee}
        onChange={(e) => set({ assignee: e.target.value })}
      >
        <option value="">Anyone</option>
        <option value="me">Me</option>
        <option value="none">Unassigned</option>
      </SelectField>
      <SelectField
        label="Priority"
        value={value.priority}
        onChange={(e) => set({ priority: e.target.value })}
      >
        <option value="">All</option>
        {ISSUE_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Type" value={value.type} onChange={(e) => set({ type: e.target.value })}>
        <option value="">All</option>
        {ISSUE_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Label"
        value={value.labelId}
        onChange={(e) => set({ labelId: e.target.value })}
      >
        <option value="">Any</option>
        {labels.data?.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
