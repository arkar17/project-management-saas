import { createProjectInput, suggestProjectKey } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { ApiError } from '../../lib/api';
import { fieldErrors } from '../../lib/auth';
import { canInWorkspace } from '../../lib/permissions';
import { useCreateProject } from '../../lib/projects';
import { useWorkspace } from '../../lib/workspaces';
import { ProjectFormFields, issuesToErrors, type ProjectFormValues } from './project-form-fields';

export function CreateProjectPage() {
  const wid = useParams().wid!;
  const workspace = useWorkspace(wid);
  const create = useCreateProject(wid);
  const navigate = useNavigate();
  const [values, setValues] = useState<ProjectFormValues>({
    name: '',
    description: '',
    status: 'ACTIVE',
    startDate: '',
    targetDate: '',
  });
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (workspace.isPending) return <Loading />;
  if (workspace.isError) return <ErrorState error={workspace.error} />;
  if (!canInWorkspace(workspace.data.myRole, 'manageProjectLifecycle')) {
    return <Alert>Only the workspace Owner and Admins can create projects.</Alert>;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createProjectInput.safeParse({
      key,
      name: values.name,
      description: values.description || null,
      status: values.status,
      startDate: values.startDate || null,
      targetDate: values.targetDate || null,
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (project) => navigate(`/workspaces/${wid}/projects/${project.id}`),
      onError: (err) => setErrors(fieldErrors(err)),
    });
  }

  const conflict = create.error instanceof ApiError && create.error.status !== 422;

  return (
    <div className="mx-auto max-w-xl">
      <Card title="New project">
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {conflict && <Alert>{errorMessage(create.error)}</Alert>}
          <ProjectFormFields
            values={values}
            errors={errors}
            onChange={(v) => {
              setValues(v);
              if (!keyEdited) setKey(suggestProjectKey(v.name));
            }}
          />
          <Field
            label="Key"
            value={key}
            error={errors.key}
            maxLength={10}
            className="font-mono uppercase"
            aria-describedby="key-hint"
            onChange={(e) => {
              setKeyEdited(true);
              setKey(e.target.value.toUpperCase());
            }}
          />
          <p id="key-hint" className="-mt-2 text-xs text-muted">
            2–10 letters or digits, used in issue keys (e.g. {key || 'WEB'}-12). It cannot be
            changed later.
          </p>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
