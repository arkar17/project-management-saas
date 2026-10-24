import { can, tenantActor, type Actor, type Capability, type WorkspaceRole } from '@pm/shared';

/** UI discoverability only; the API enforces the same matrix (CLAUDE.md §5). */
export function canInWorkspace(role: WorkspaceRole | undefined, capability: Capability, ctx = {}) {
  return role ? can(tenantActor(role, null), capability, ctx) : false;
}

/** Project-scoped check using the effective access the API reported for this project. */
export function canInProject(access: string | undefined, capability: Capability, ctx = {}) {
  return access ? can(access as Actor, capability, ctx) : false;
}
