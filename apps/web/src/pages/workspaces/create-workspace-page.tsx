import { createWorkspaceInput, slugify } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { ApiError } from '../../lib/api';
import { fieldErrors, useMe } from '../../lib/auth';
import { lastWorkspace, useCreateWorkspace } from '../../lib/workspaces';
import { TimezoneSelect } from './timezone-select';

export function CreateWorkspacePage() {
  const { data: user } = useMe();
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [timezone, setTimezone] = useState(user?.timezone ?? 'UTC');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createWorkspaceInput.safeParse({ name, slug: slug || undefined, timezone });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      return setErrors(next);
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (ws) => {
        lastWorkspace.set(ws.id);
        navigate(`/workspaces/${ws.id}`);
      },
      onError: (err) => setErrors(fieldErrors(err)),
    });
  }

  const conflict = create.error instanceof ApiError && create.error.status !== 422;

  return (
    <div className="mx-auto max-w-lg">
      <Card title="Create a workspace">
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {conflict && <Alert>{errorMessage(create.error)}</Alert>}
          <Field
            label="Workspace name"
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            required
          />
          <Field
            label="URL slug"
            value={slug}
            error={errors.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            aria-describedby="slug-hint"
          />
          <p id="slug-hint" className="-mt-2 text-xs text-muted">
            Lower-case letters, numbers and hyphens. Must be unique.
          </p>
          <TimezoneSelect value={timezone} onChange={setTimezone} error={errors.timezone} />
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
