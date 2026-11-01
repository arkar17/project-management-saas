import { updateProjectInput } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/auth';
import { canInProject } from '../../lib/permissions';
import { useSetArchived, useUpdateProject } from '../../lib/projects';
import { LabelManager } from './label-manager';
import { ProjectFormFields, issuesToErrors, type ProjectFormValues } from './project-form-fields';
import { useProjectContext } from './project-layout';

export function ProjectSettingsPage() {
  const { project } = useProjectContext();
  const canEdit = canInProject(project.myAccess, 'manageProjectSettingsAndMembers');
  const canArchive = canInProject(project.myAccess, 'manageProjectLifecycle');
  const archived = project.archivedAt !== null;

  return (
    <div className="space-y-6">
      {!canEdit && (
        <Alert tone="info">
          Only project managers and workspace Owners/Admins can change project settings.
        </Alert>
      )}
      <GeneralSettings
        key={project.id + project.name + project.status + project.startDate + project.targetDate}
        disabled={!canEdit || archived}
      />
      <LabelManager
        pid={project.id}
        editable={canInProject(project.myAccess, 'manageLabels') && !archived}
      />
      {canArchive && <ArchiveSection archived={archived} />}
    </div>
  );
}

function GeneralSettings({ disabled }: { disabled: boolean }) {
  const { project } = useProjectContext();
  const update = useUpdateProject(project.id);
  const initial: ProjectFormValues = {
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    startDate: project.startDate ?? '',
    targetDate: project.targetDate ?? '',
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (values.name !== initial.name) changes.name = values.name;
    if (values.description !== initial.description)
      changes.description = values.description || null;
    if (values.status !== initial.status) changes.status = values.status;
    if (values.startDate !== initial.startDate) changes.startDate = values.startDate || null;
    if (values.targetDate !== initial.targetDate) changes.targetDate = values.targetDate || null;
    const parsed = updateProjectInput.safeParse(changes);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    update.mutate(parsed.data, { onError: (err) => setErrors(fieldErrors(err)) });
  }

  return (
    <Card title="Project details">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {errors.form && <Alert>{errors.form}</Alert>}
        {update.isError && !Object.keys(errors).length && (
          <Alert>{errorMessage(update.error)}</Alert>
        )}
        {update.isSuccess && <Alert tone="info">Project updated.</Alert>}
        <Field
          label="Key"
          value={project.key}
          disabled
          readOnly
          aria-describedby="key-fixed"
          className="font-mono"
        />
        <p id="key-fixed" className="-mt-2 text-xs text-muted">
          Project keys are permanent.
        </p>
        <ProjectFormFields
          values={values}
          onChange={setValues}
          errors={errors}
          disabled={disabled}
        />
        {!disabled && (
          <Button type="submit" className="sm:w-auto" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </form>
    </Card>
  );
}

function ArchiveSection({ archived }: { archived: boolean }) {
  const { project } = useProjectContext();
  const setArchived = useSetArchived(project.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card title={archived ? 'Unarchive project' : 'Archive project'}>
      <p className="text-sm text-muted">
        {archived
          ? 'Unarchiving restores editing for project members.'
          : 'Archived projects become read-only. Keys, issues and history are kept, and you can unarchive at any time.'}
      </p>
      {setArchived.isError && (
        <div className="mt-3">
          <Alert>{errorMessage(setArchived.error)}</Alert>
        </div>
      )}
      <Button
        type="button"
        className={`mt-4 sm:w-auto ${archived ? '' : 'bg-destructive'}`}
        onClick={() => setConfirming(true)}
      >
        {archived ? 'Unarchive…' : 'Archive…'}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={archived ? `Unarchive ${project.key}?` : `Archive ${project.key}?`}
        confirmLabel={archived ? 'Unarchive' : 'Archive'}
        destructive={!archived}
        pending={setArchived.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => setArchived.mutate(!archived, { onSettled: () => setConfirming(false) })}
      >
        <p>
          {archived
            ? 'Members will be able to edit this project again.'
            : 'No one can change this project until it is unarchived.'}
        </p>
      </ConfirmDialog>
    </Card>
  );
}
