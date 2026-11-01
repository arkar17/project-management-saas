import { labelInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { useCreateLabel, useDeleteLabel, useLabels } from '../../lib/issues';
import { LabelChip } from '../issues/issue-meta';

/** FR-ISS-005: PM+ create/delete project labels; deleting removes them from issues. */
export function LabelManager({ pid, editable }: { pid: string; editable: boolean }) {
  const labels = useLabels(pid);
  const create = useCreateLabel(pid);
  const remove = useDeleteLabel();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4f46e5');
  const [invalid, setInvalid] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = labelInput.safeParse({ name, color });
    setInvalid(parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid label'));
    if (parsed.success) create.mutate(parsed.data, { onSuccess: () => setName('') });
  }

  return (
    <Card title="Labels">
      {(invalid || create.isError || remove.isError) && (
        <Alert>{invalid ?? errorMessage(create.error ?? remove.error)}</Alert>
      )}
      <ul className="my-3 flex flex-wrap gap-2">
        {labels.data?.length === 0 && <li className="text-sm text-muted">No labels yet.</li>}
        {labels.data?.map((l) => (
          <li key={l.id} className="flex items-center gap-1">
            <LabelChip {...l} />
            {editable && (
              <button
                type="button"
                aria-label={`Delete label ${l.name}`}
                className="rounded px-1 text-xs text-destructive hover:bg-red-50"
                onClick={() => remove.mutate(l.id)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end" onSubmit={onSubmit}>
          <Field
            label="New label"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Colour"
            type="color"
            value={color}
            className="p-1"
            onChange={(e) => setColor(e.target.value)}
          />
          <Button type="submit" className="sm:w-auto" disabled={create.isPending || !name.trim()}>
            Add label
          </Button>
        </form>
      )}
    </Card>
  );
}
