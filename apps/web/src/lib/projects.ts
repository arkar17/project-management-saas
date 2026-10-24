import type {
  AddProjectMemberInput,
  CreateProjectInput,
  ProjectDto,
  ProjectListDto,
  ProjectMemberDto,
  ProjectOverviewDto,
  UpdateProjectInput,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface ProjectFilters {
  search: string;
  status: string;
  archived: 'active' | 'archived' | 'all';
}

export const projectKeys = {
  all: ['projects'] as const,
  list: (wid: string, f: ProjectFilters) => ['projects', 'list', wid, f] as const,
  detail: (pid: string) => ['projects', pid] as const,
  members: (pid: string) => ['projects', pid, 'members'] as const,
  overview: (pid: string) => ['projects', pid, 'overview'] as const,
};

export function useProjects(wid: string, filters: ProjectFilters) {
  const params = new URLSearchParams({ archived: filters.archived, pageSize: '100' });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  return useQuery({
    queryKey: projectKeys.list(wid, filters),
    queryFn: () => api<ProjectListDto>(`/workspaces/${wid}/projects?${params}`),
    placeholderData: (prev) => prev,
  });
}

export function useProject(pid: string) {
  return useQuery({
    queryKey: projectKeys.detail(pid),
    queryFn: async () => (await api<{ project: ProjectDto }>(`/projects/${pid}`)).project,
  });
}

export function useProjectOverview(pid: string) {
  return useQuery({
    queryKey: projectKeys.overview(pid),
    queryFn: async () =>
      (await api<{ overview: ProjectOverviewDto }>(`/projects/${pid}/reports/overview`)).overview,
  });
}

export function useProjectMembers(pid: string) {
  return useQuery({
    queryKey: projectKeys.members(pid),
    queryFn: async () =>
      (await api<{ members: ProjectMemberDto[] }>(`/projects/${pid}/members`)).members,
  });
}

function useProjectMutation<T, R = unknown>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Workspace counts include projects, so refresh both caches.
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: projectKeys.all }),
        qc.invalidateQueries({ queryKey: ['workspaces'] }),
      ]),
  });
}

export const useCreateProject = (wid: string) =>
  useProjectMutation(
    async (input: CreateProjectInput) =>
      (
        await api<{ project: ProjectDto }>(`/workspaces/${wid}/projects`, {
          method: 'POST',
          body: input,
        })
      ).project,
  );

export const useUpdateProject = (pid: string) =>
  useProjectMutation((input: UpdateProjectInput) =>
    api(`/projects/${pid}`, { method: 'PATCH', body: input }),
  );

export const useSetArchived = (pid: string) =>
  useProjectMutation((archived: boolean) =>
    api(`/projects/${pid}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' }),
  );

export const useAddProjectMember = (pid: string) =>
  useProjectMutation((input: AddProjectMemberInput) =>
    api(`/projects/${pid}/members`, { method: 'POST', body: input }),
  );

export const useChangeProjectRole = (pid: string) =>
  useProjectMutation(
    ({ memberId, role }: { memberId: string; role: 'PROJECT_MANAGER' | 'MEMBER' }) =>
      api(`/projects/${pid}/members/${memberId}`, { method: 'PATCH', body: { role } }),
  );

export const useRemoveProjectMember = (pid: string) =>
  useProjectMutation((memberId: string) =>
    api(`/projects/${pid}/members/${memberId}`, { method: 'DELETE' }),
  );
