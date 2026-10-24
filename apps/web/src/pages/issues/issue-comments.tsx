import { COMMENT_EDIT_WINDOW_MS, type CommentDto } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { useMe } from '../../lib/auth';
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useEditComment,
  useModerateComment,
} from '../../lib/issues';

const linkBtn = 'rounded px-1.5 py-0.5 text-xs font-medium hover:bg-slate-100';

export function IssueComments({
  issueId,
  canComment,
  canModerate,
}: {
  issueId: string;
  canComment: boolean;
  canModerate: boolean;
}) {
  const comments = useComments(issueId);
  const add = useAddComment(issueId);
  const edit = useEditComment();
  const remove = useDeleteComment();
  const moderate = useModerateComment();
  const { data: me } = useMe();
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [moderating, setModerating] = useState<CommentDto | null>(null);
  const [reason, setReason] = useState('');
  const error = add.error ?? edit.error ?? remove.error ?? moderate.error;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim()) add.mutate(body, { onSuccess: () => setBody('') });
  }

  return (
    <Card title="Comments">
      {error && <Alert>{errorMessage(error)}</Alert>}
      {comments.isPending ? (
        <Loading />
      ) : comments.isError ? (
        <ErrorState error={comments.error} />
      ) : comments.data.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {comments.data.map((c) => {
            const mine = c.author.id === me?.id;
            const editable =
              mine &&
              !c.removed &&
              Date.now() - new Date(c.createdAt).getTime() < COMMENT_EDIT_WINDOW_MS;
            return (
              <li key={c.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-slate-900">{c.author.name}</span>
                  <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
                  {c.editedAt && <span>(edited)</span>}
                  <span className="ml-auto flex gap-1">
                    {editable && canComment && (
                      <button
                        type="button"
                        className={linkBtn}
                        onClick={() => setEditing({ id: c.id, body: c.body ?? '' })}
                      >
                        Edit
                      </button>
                    )}
                    {mine && !c.removed && canComment && (
                      <button
                        type="button"
                        className={`${linkBtn} text-destructive`}
                        onClick={() => remove.mutate(c.id)}
                      >
                        Delete
                      </button>
                    )}
                    {!mine && !c.removed && canModerate && (
                      <button
                        type="button"
                        className={`${linkBtn} text-destructive`}
                        onClick={() => setModerating(c)}
                      >
                        Remove…
                      </button>
                    )}
                  </span>
                </div>
                {c.removed ? (
                  <p className="mt-1 text-sm italic text-muted">
                    {c.moderated ? 'Comment removed by a moderator' : 'Comment deleted'}
                  </p>
                ) : editing?.id === c.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      aria-label="Edit comment"
                      rows={3}
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                      className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        className="h-8 sm:w-auto"
                        disabled={edit.isPending}
                        onClick={() => edit.mutate(editing, { onSuccess: () => setEditing(null) })}
                      >
                        Save
                      </Button>
                      <Button
                        className="h-8 bg-white text-slate-900 ring-1 ring-border sm:w-auto"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canComment && (
        <form className="mt-4 space-y-2" onSubmit={onSubmit}>
          <label htmlFor="new-comment" className="block text-sm font-medium">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Mention someone with @their@email"
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
          <Button type="submit" className="sm:w-auto" disabled={add.isPending || !body.trim()}>
            {add.isPending ? 'Posting…' : 'Comment'}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={moderating !== null}
        title="Remove this comment?"
        confirmLabel="Remove comment"
        destructive
        pending={moderate.isPending}
        onCancel={() => {
          setModerating(null);
          setReason('');
        }}
        onConfirm={() => {
          if (!moderating || !reason.trim()) return;
          moderate.mutate(
            { id: moderating.id, reason },
            {
              onSettled: () => {
                setModerating(null);
                setReason('');
              },
            },
          );
        }}
      >
        <p>The text is hidden from everyone. Your reason is recorded in the audit log.</p>
        <Field
          label="Reason (required)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}
