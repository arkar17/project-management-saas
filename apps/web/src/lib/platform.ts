import type {
  AuthUserDto,
  LoginInput,
  PlatformAuditEntryDto,
  PlatformMetricsDto,
  PlatformUserDto,
  PlatformWorkspaceDto,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

/** PLATFORM session (separate cookie, ADR-001/007); never shared with the APP session. */
const meKey = ['platform', 'me'] as const;

interface Page {
  total: number;
  page: number;
  pageSize: number;
}

export function usePlatformMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return (await api<{ user: AuthUserDto }>('/platform/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
  });
}

export function usePlatformLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<{ user: AuthUserDto }>('/platform/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  });
}

export function usePlatformLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/platform/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(meKey, null);
      void qc.removeQueries({ queryKey: ['platform', 'data'] });
    },
  });
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const usePlatformMetrics = () =>
  useQuery({
    queryKey: ['platform', 'data', 'metrics'],
    queryFn: () => api<PlatformMetricsDto>('/platform/metrics'),
  });

export const usePlatformWorkspaces = (f: { search: string; status: string; page: number }) =>
  useQuery({
    queryKey: ['platform', 'data', 'workspaces', f],
    queryFn: () =>
      api<{ workspaces: PlatformWorkspaceDto[] } & Page>(`/platform/workspaces?${qs(f)}`),
    placeholderData: (prev) => prev,
  });

export const usePlatformWorkspace = (wid: string) =>
  useQuery({
    queryKey: ['platform', 'data', 'workspace', wid],
    queryFn: () =>
      api<{
        workspace: PlatformWorkspaceDto & { archivedProjects: number; pendingInvitations: number };
        statusHistory: PlatformAuditEntryDto[];
      }>(`/platform/workspaces/${wid}`),
  });

export const usePlatformUsers = (f: { search: string; status: string; page: number }) =>
  useQuery({
    queryKey: ['platform', 'data', 'users', f],
    queryFn: () => api<{ users: PlatformUserDto[] } & Page>(`/platform/users?${qs(f)}`),
    placeholderData: (prev) => prev,
  });

export const usePlatformAudit = (f: { action: string; actorType: string; page: number }) =>
  useQuery({
    queryKey: ['platform', 'data', 'audit', f],
    queryFn: () => api<{ entries: PlatformAuditEntryDto[] } & Page>(`/platform/audit?${qs(f)}`),
    placeholderData: (prev) => prev,
  });

export function useWorkspaceStatus(wid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ suspend, reason }: { suspend: boolean; reason: string }) =>
      api(`/platform/workspaces/${wid}/${suspend ? 'suspend' : 'reactivate'}`, {
        method: 'POST',
        body: { reason },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['platform', 'data'] }),
  });
}
