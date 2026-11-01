import type { AuthUserDto, LoginInput, RegisterInput } from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const meQueryKey = ['auth', 'me'] as const;

/** Current APP-session user, or null when signed out (401). */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return (await api<{ user: AuthUserDto }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<{ user: AuthUserDto }>('/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => qc.setQueryData(meQueryKey, user),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegisterInput) => api('/auth/register', { method: 'POST', body: input }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => qc.setQueryData(meQueryKey, null),
  });
}

/** Maps Zod issue details from a 422 to a field → message record. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.body.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.body.details as { path: string; message: string }[])
    out[d.path] ??= d.message;
  return out;
}
