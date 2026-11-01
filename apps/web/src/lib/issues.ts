import type {
  ActivityDto,
  AttachmentDownloadDto,
  AttachmentDto,
  AttachmentUploadDto,
  CommentDto,
  CreateIssueInput,
  IssueDto,
  IssueListDto,
  LabelDto,
  UpdateIssueInput,
  WatchersDto,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface IssueFilters {
  search: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  labelId: string;
  deleted: boolean;
}

export const emptyIssueFilters: IssueFilters = {
  search: '',
  type: '',
  status: '',
  priority: '',
  assignee: '',
  labelId: '',
  deleted: false,
};

export const issueKeys = {
  all: ['issues'] as const,
  list: (pid: string, f: unknown) => ['issues', 'list', pid, f] as const,
  detail: (iid: string) => ['issues', iid] as const,
  labels: (pid: string) => ['issues', 'labels', pid] as const,
};

export function useIssues(pid: string, f: IssueFilters, pageSize = 50) {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  for (const k of ['search', 'type', 'status', 'priority', 'assignee', 'labelId'] as const) {
    if (f[k].trim()) params.set(k, f[k].trim());
  }
  if (f.deleted) params.set('deleted', 'true');
  return useQuery({
    queryKey: issueKeys.list(pid, f),
    queryFn: () => api<IssueListDto>(`/projects/${pid}/issues?${params}`),
    placeholderData: (prev) => prev,
  });
}

export const useIssue = (iid: string) =>
  useQuery({
    queryKey: issueKeys.detail(iid),
    queryFn: async () => (await api<{ issue: IssueDto }>(`/issues/${iid}`)).issue,
  });

function useIssuePart<T>(iid: string, part: string, pick: (body: never) => T) {
  return useQuery({
    queryKey: [...issueKeys.detail(iid), part],
    queryFn: async () => pick(await api<never>(`/issues/${iid}/${part}`)),
  });
}

export const useChildren = (iid: string) =>
  useIssuePart(iid, 'children', (r: { issues: IssueDto[] }) => r.issues);
export const useComments = (iid: string) =>
  useIssuePart(iid, 'comments', (r: { comments: CommentDto[] }) => r.comments);
export const useActivity = (iid: string) =>
  useIssuePart(iid, 'activity', (r: { activity: ActivityDto[] }) => r.activity);
export const useWatchers = (iid: string) => useIssuePart(iid, 'watchers', (r: WatchersDto) => r);
export const useAttachments = (iid: string) =>
  useIssuePart(iid, 'attachments', (r: { attachments: AttachmentDto[] }) => r.attachments);

export const useLabels = (pid: string) =>
  useQuery({
    queryKey: issueKeys.labels(pid),
    queryFn: async () => (await api<{ labels: LabelDto[] }>(`/projects/${pid}/labels`)).labels,
  });

/** Issue changes can affect lists, details, children and the project overview. */
function useIssueMutation<T, R = unknown>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: issueKeys.all }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  });
}

export const useCreateIssue = (pid: string) =>
  useIssueMutation(
    async (input: CreateIssueInput) =>
      (await api<{ issue: IssueDto }>(`/projects/${pid}/issues`, { method: 'POST', body: input }))
        .issue,
  );
export const useUpdateIssue = (iid: string) =>
  useIssueMutation((input: UpdateIssueInput) =>
    api(`/issues/${iid}`, { method: 'PATCH', body: input }),
  );
export const useSetIssueLabels = (iid: string) =>
  useIssueMutation((labelIds: string[]) =>
    api(`/issues/${iid}/labels`, { method: 'PUT', body: { labelIds } }),
  );
export const useDeleteIssue = (iid: string) =>
  useIssueMutation(() => api(`/issues/${iid}`, { method: 'DELETE' }));
export const useRestoreIssue = (iid: string) =>
  useIssueMutation(() => api(`/issues/${iid}/restore`, { method: 'POST' }));
export const useWatch = (iid: string) =>
  useIssueMutation((watching: boolean) =>
    api(`/issues/${iid}/watch`, { method: watching ? 'POST' : 'DELETE' }),
  );
export const useAddComment = (iid: string) =>
  useIssueMutation((body: string) =>
    api(`/issues/${iid}/comments`, { method: 'POST', body: { body } }),
  );
export const useEditComment = () =>
  useIssueMutation(({ id, body }: { id: string; body: string }) =>
    api(`/comments/${id}`, { method: 'PATCH', body: { body } }),
  );
export const useDeleteComment = () =>
  useIssueMutation((id: string) => api(`/comments/${id}`, { method: 'DELETE' }));
export const useModerateComment = () =>
  useIssueMutation(({ id, reason }: { id: string; reason: string }) =>
    api(`/comments/${id}/moderate`, { method: 'POST', body: { reason } }),
  );
export const useCreateLabel = (pid: string) =>
  useIssueMutation((input: { name: string; color: string }) =>
    api(`/projects/${pid}/labels`, { method: 'POST', body: input }),
  );
export const useDeleteLabel = () =>
  useIssueMutation((id: string) => api(`/labels/${id}`, { method: 'DELETE' }));

/** Uploads straight to private storage through the signed PUT; reports progress 0–1. */
function putToStorage(upload: AttachmentUploadDto, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(xhr.status === 403 ? 'Upload link expired; try again' : 'Upload failed'),
          );
    xhr.onerror = () => reject(new Error('Upload failed; check your connection'));
    xhr.send(file);
  });
}

/** FR-ISS-006 / ADR-004: initiate → signed PUT → confirm (server sniffs the content). */
export async function uploadAttachment(
  iid: string,
  file: File,
  mimeType: string,
  onProgress: (p: number) => void,
): Promise<AttachmentDto> {
  const { upload } = await api<{ upload: AttachmentUploadDto }>(`/issues/${iid}/attachments`, {
    method: 'POST',
    body: { filename: file.name, mimeType, sizeBytes: file.size },
  });
  await putToStorage(upload, file, onProgress);
  const { attachment } = await api<{ attachment: AttachmentDto }>(
    `/issues/${iid}/attachments/confirm`,
    { method: 'POST', body: { uploadId: upload.uploadId } },
  );
  return attachment;
}

/** Asks for a fresh 5-minute signed URL each time; the server re-authorizes the caller. */
export async function downloadAttachment(aid: string): Promise<void> {
  const { download } = await api<{ download: AttachmentDownloadDto }>(
    `/attachments/${aid}/download`,
  );
  const a = document.createElement('a');
  a.href = download.url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
