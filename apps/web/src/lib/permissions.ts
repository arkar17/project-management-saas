import { can, tenantActor, type Capability, type WorkspaceRole } from '@pm/shared';

/** UI discoverability only; the API enforces the same matrix (CLAUDE.md §5). */
export function canInWorkspace(role: WorkspaceRole | undefined, capability: Capability, ctx = {}) {
  return role ? can(tenantActor(role, null), capability, ctx) : false;
}
