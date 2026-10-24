import type {
  CreateWorkspaceInput,
  InvitationDto,
  InvitationPreviewDto,
  InviteInput,
  MemberDto,
  UpdateWorkspaceInput,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (wid: string) => ['workspaces', wid] as const,
  members: (wid: string) => ['workspaces', wid, 'members'] as const,
  invitations: (wid: string) => ['workspaces', wid, 'invitations'] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () =>
      (await api<{ workspaces: WorkspaceSummaryDto[] }>('/workspaces')).workspaces,
  });
}

export function useWorkspace(wid: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(wid),
    queryFn: async () =>
      (await api<{ workspace: WorkspaceDetailDto }>(`/workspaces/${wid}`)).workspace,
  });
}

export function useMembers(wid: string) {
  return useQuery({
    queryKey: workspaceKeys.members(wid),
    queryFn: async () =>
      (await api<{ members: MemberDto[] }>(`/workspaces/${wid}/members`)).members,
  });
}

export function useInvitations(wid: string, enabled: boolean) {
  return useQuery({
    queryKey: workspaceKeys.invitations(wid),
    enabled,
    queryFn: async () =>
      (await api<{ invitations: InvitationDto[] }>(`/workspaces/${wid}/invitations`)).invitations,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkspaceInput) =>
      (
        await api<{ workspace: WorkspaceSummaryDto }>('/workspaces', {
          method: 'POST',
          body: input,
        })
      ).workspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

/** Any change under a workspace refreshes everything cached for it (small payloads). */
function useWorkspaceMutation<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export const useUpdateWorkspace = (wid: string) =>
  useWorkspaceMutation((input: UpdateWorkspaceInput) =>
    api(`/workspaces/${wid}`, { method: 'PATCH', body: input }),
  );

export const useChangeRole = (wid: string) =>
  useWorkspaceMutation(({ memberId, role }: { memberId: string; role: 'ADMIN' | 'MEMBER' }) =>
    api(`/workspaces/${wid}/members/${memberId}`, { method: 'PATCH', body: { role } }),
  );

export const useRemoveMember = (wid: string) =>
  useWorkspaceMutation((memberId: string) =>
    api(`/workspaces/${wid}/members/${memberId}`, { method: 'DELETE' }),
  );

export const useTransferOwnership = (wid: string) =>
  useWorkspaceMutation((memberId: string) =>
    api(`/workspaces/${wid}/transfer-ownership`, { method: 'POST', body: { memberId } }),
  );

export const useInvite = (wid: string) =>
  useWorkspaceMutation((input: InviteInput) =>
    api(`/workspaces/${wid}/invitations`, { method: 'POST', body: input }),
  );

export const useResendInvitation = () =>
  useWorkspaceMutation((id: string) => api(`/invitations/${id}/resend`, { method: 'POST' }));

export const useRevokeInvitation = () =>
  useWorkspaceMutation((id: string) => api(`/invitations/${id}/revoke`, { method: 'POST' }));

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: ['invitation-preview', token],
    enabled: token !== null,
    retry: false,
    queryFn: async () =>
      (
        await api<{ invitation: InvitationPreviewDto }>(
          `/invitations/preview?token=${encodeURIComponent(token ?? '')}`,
        )
      ).invitation,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<{ workspaceId: string }>('/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

// Per-viewer conveniences only; storage may be unavailable (private mode), so never required.
const LAST_KEY = 'pm_last_workspace';
const INVITE_KEY = 'pm_pending_invite';

function safeStorage<T>(fn: (s: Storage) => T, fallback: T): T {
  try {
    return fn(window.localStorage);
  } catch {
    return fallback;
  }
}

export const lastWorkspace = {
  get: () => safeStorage((s) => s.getItem(LAST_KEY), null),
  set: (wid: string) => safeStorage((s) => s.setItem(LAST_KEY, wid), undefined),
};

/** Keeps the invitation link across register → verify (new tab) → sign in. */
export const pendingInvite = {
  get: () => safeStorage((s) => s.getItem(INVITE_KEY), null),
  set: (token: string) => safeStorage((s) => s.setItem(INVITE_KEY, token), undefined),
  clear: () => safeStorage((s) => s.removeItem(INVITE_KEY), undefined),
};
