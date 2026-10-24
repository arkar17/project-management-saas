import type { BurndownDto, VelocityDto, WorkloadDto, WorkspaceOverviewDto } from '@pm/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useWorkspaceOverview = (wid: string) =>
  useQuery({
    queryKey: ['reports', 'workspace', wid],
    queryFn: () => api<WorkspaceOverviewDto>(`/workspaces/${wid}/overview`),
  });

export const useVelocity = (pid: string) =>
  useQuery({
    queryKey: ['reports', 'velocity', pid],
    queryFn: () => api<VelocityDto>(`/projects/${pid}/reports/velocity`),
  });

export const useWorkload = (pid: string) =>
  useQuery({
    queryKey: ['reports', 'workload', pid],
    queryFn: () => api<WorkloadDto>(`/projects/${pid}/reports/workload`),
  });

export const useBurndown = (sid: string, enabled = true) =>
  useQuery({
    queryKey: ['reports', 'burndown', sid],
    enabled,
    queryFn: () => api<BurndownDto>(`/sprints/${sid}/burndown`),
  });
