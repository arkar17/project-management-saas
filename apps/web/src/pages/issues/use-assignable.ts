import { useProjectMembers } from '../../lib/projects';
import { useMembers } from '../../lib/workspaces';

/** FR-ISS-009 eligible assignees: ACTIVE project members plus workspace Owner/Admins. */
export function useAssignable(wid: string, pid: string) {
  const projectMembers = useProjectMembers(pid);
  const workspaceMembers = useMembers(wid);
  const people = new Map<string, string>();
  for (const m of workspaceMembers.data ?? [])
    if (m.role !== 'MEMBER') people.set(m.userId, m.name);
  for (const m of projectMembers.data ?? []) people.set(m.userId, m.name);
  return [...people]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
