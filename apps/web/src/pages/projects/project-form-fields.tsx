import { PROJECT_STATUSES, type ProjectStatus } from '@pm/shared';
import { useId } from 'react';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { STATUS_LABEL } from './project-status';

export interface ProjectFormValues {
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string;
  targetDate: string;
}

/** Fields shared by the create form and project settings. */
export function ProjectFormFields({
  values,
  onChange,
  errors,
  disabled,
}: {
  values: ProjectFormValues;
  onChange: (v: ProjectFormValues) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const descId = useId();
  return (
    <>
      <Field
        label="Name"
        value={values.name}
        error={errors.name}
        disabled={disabled}
        onChange={(e) => onChange({ ...values, name: e.target.value })}
      />
      <div className="space-y-1.5">
        <label htmlFor={descId} className="block text-sm font-medium">
          Description
        </label>
        <textarea
          id={descId}
          rows={3}
          disabled={disabled}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:bg-slate-100"
        />
      </div>
      <SelectField
        label="Status"
        value={values.status}
        disabled={disabled}
        onChange={(e) => onChange({ ...values, status: e.target.value as ProjectStatus })}
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Start date"
          type="date"
          value={values.startDate}
          error={errors.startDate}
          disabled={disabled}
          onChange={(e) => onChange({ ...values, startDate: e.target.value })}
        />
        <Field
          label="Target date"
          type="date"
          value={values.targetDate}
          error={errors.targetDate}
          disabled={disabled}
          onChange={(e) => onChange({ ...values, targetDate: e.target.value })}
        />
      </div>
    </>
  );
}

export function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}
