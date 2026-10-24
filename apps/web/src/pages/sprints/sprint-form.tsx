import { createSprintInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { useCreateSprint } from '../../lib/sprints';
import { issuesToErrors } from '../projects/project-form-fields';

const toInput = (d: Date) => d.toISOString().slice(0, 10);
/** Dates are whole days: start of the first day to end of the last day, local time. */
export const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
export const dayEnd = (d: string) => new Date(`${d}T23:59:59`).toISOString();

export function NewSprintForm({
  pid,
  onCreated,
}: {
  pid: string;
  onCreated?: (sid: string) => void;
}) {
  const create = useCreateSprint(pid);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState(toInput(new Date()));
  const [end, setEnd] = useState(toInput(new Date(Date.now() + 13 * 86_400_000)));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createSprintInput.safeParse({
      name,
      goal: goal || null,
      startAt: dayStart(start),
      endAt: dayEnd(end),
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (d) => {
        setName('');
        setGoal('');
        onCreated?.(d.sprint.id);
      },
    });
  }

  return (
    <Card title="New sprint">
      <form className="space-y-3" onSubmit={onSubmit} noValidate>
        {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
        <Field
          label="Name"
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sprint 1"
        />
        <Field label="Goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Field
            label="End"
            type="date"
            value={end}
            error={errors.endAt}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create sprint'}
        </Button>
      </form>
    </Card>
  );
}
