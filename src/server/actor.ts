import type { Permission, RoleKey } from '@/lib/permissions';
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { forbidden } from './errors';

export type UserActor = {
  kind: 'user';
  id: string;
  orgId: string;
  name: string;
  email: string;
  roleKey: RoleKey | string;
  roleName: string;
  /** Display-only job title, e.g. "CMO". */
  jobTitle?: string | null;
  /** Set for external client reviewers only. */
  clientId: string | null;
  permissions: ReadonlySet<Permission>;
};

export type SystemActor = {
  kind: 'system';
  id: null;
  orgId: string;
  name: string;
  clientId: null;
  permissions: ReadonlySet<Permission>;
};

export type Actor = UserActor | SystemActor;

export function systemActor(orgId: string, name = 'Automation'): SystemActor {
  return { kind: 'system', id: null, orgId, name, clientId: null, permissions: new Set(ALL_PERMISSIONS) };
}

export function can(actor: Actor, ...perms: Permission[]): boolean {
  return perms.every((p) => actor.permissions.has(p));
}

export function canAny(actor: Actor, ...perms: Permission[]): boolean {
  return perms.some((p) => actor.permissions.has(p));
}

export function assertCan(actor: Actor, ...perms: Permission[]): void {
  if (!can(actor, ...perms)) throw forbidden();
}

export function assertCanAny(actor: Actor, ...perms: Permission[]): void {
  if (!canAny(actor, ...perms)) throw forbidden();
}

export const actorUserId = (actor: Actor) => (actor.kind === 'user' ? actor.id : null);
export const isClientReviewer = (actor: Actor) => actor.kind === 'user' && actor.clientId !== null;
