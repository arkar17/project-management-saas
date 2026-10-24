import {
  ATTACHMENT_ACCEPT,
  attachmentExtension,
  attachmentFileError,
  attachmentMimeFor,
} from '@pm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type DragEvent } from 'react';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Card } from '../../components/ui/card';
import { downloadAttachment, issueKeys, uploadAttachment, useAttachments } from '../../lib/issues';

interface UploadItem {
  key: string;
  name: string;
  progress: number;
  error: string | null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const linkBtn = 'rounded px-2 py-1 text-sm font-medium text-primary hover:bg-slate-100';

export function IssueAttachments({ issueId, canUpload }: { issueId: string; canUpload: boolean }) {
  const attachments = useAttachments(issueId);
  const qc = useQueryClient();
  const inputId = useId();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const patch = (key: string, change: Partial<UploadItem>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  function start(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      // Same rules as the API, so obvious rejections never leave the browser.
      const mimeType = attachmentMimeFor(file.name);
      const error = mimeType
        ? attachmentFileError(file.name, file.size, mimeType)
        : `.${attachmentExtension(file.name) || '?'} files are not allowed`;
      setUploads((list) => [...list, { key, name: file.name, progress: 0, error }]);
      if (error || !mimeType) continue;
      uploadAttachment(issueId, file, mimeType, (progress) => patch(key, { progress }))
        .then(() => {
          setUploads((list) => list.filter((u) => u.key !== key));
          return qc.invalidateQueries({ queryKey: issueKeys.detail(issueId) });
        })
        .catch((err: unknown) =>
          patch(key, { error: err instanceof Error ? err.message : errorMessage(err) }),
        );
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (canUpload && e.dataTransfer.files.length > 0) start(e.dataTransfer.files);
  }

  return (
    <Card title="Attachments">
      {downloadError && <Alert>{downloadError}</Alert>}
      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mb-4 rounded-lg border-2 border-dashed p-4 text-center text-sm ${
            dragging ? 'border-primary bg-indigo-50' : 'border-border'
          }`}
        >
          <label htmlFor={inputId} className="cursor-pointer font-medium text-primary">
            Choose files
          </label>{' '}
          <span className="text-muted">or drag them here</span>
          <input
            id={inputId}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) start(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="mt-1 text-xs text-muted">
            Images, PDF, text, CSV, Markdown or ZIP · up to 10 MB each
          </p>
        </div>
      )}
      {uploads.length > 0 && (
        <ul className="mb-4 space-y-2" aria-label="Uploads in progress">
          {uploads.map((u) => (
            <li key={u.key} className="rounded-md bg-slate-50 p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? (
                  <button
                    type="button"
                    className={linkBtn}
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    Dismiss
                  </button>
                ) : (
                  <span className="text-xs text-muted">{Math.round(u.progress * 100)}%</span>
                )}
              </div>
              {u.error ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {u.error}
                </p>
              ) : (
                <progress
                  className="mt-1 h-1.5 w-full"
                  max={1}
                  value={u.progress}
                  aria-label={`Uploading ${u.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {attachments.isPending ? (
        <Loading />
      ) : attachments.isError ? (
        <ErrorState error={attachments.error} />
      ) : attachments.data.length === 0 ? (
        <p className="text-sm text-muted">No attachments yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {attachments.data.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={a.filename}>
                  {a.filename}
                </p>
                <p className="text-xs text-muted">
                  {attachmentExtension(a.filename).toUpperCase()} · {formatBytes(a.sizeBytes)} ·{' '}
                  {a.uploader.name} ·{' '}
                  <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleDateString()}</time>
                </p>
              </div>
              <button
                type="button"
                className={`${linkBtn} self-start sm:self-auto`}
                aria-label={`Download ${a.filename}`}
                onClick={() => {
                  setDownloadError(null);
                  downloadAttachment(a.id).catch((err: unknown) =>
                    setDownloadError(errorMessage(err)),
                  );
                }}
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
