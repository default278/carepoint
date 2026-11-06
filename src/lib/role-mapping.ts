import type { Role } from '../types';

const validRoles = new Set<Role>([
  'admin',
  'receptionist',
  'doctor',
  'patient',
  'lab_technician',
  'pharmacist',
]);

function asRows(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function relationValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function extractAssignedRoles(userRoles: unknown): Role[] {
  const found = new Set<Role>();

  for (const assignment of asRows(userRoles)) {
    for (const role of asRows(relationValue(assignment, 'roles'))) {
      const name = relationValue(role, 'name');
      if (typeof name === 'string' && validRoles.has(name as Role)) {
        found.add(name as Role);
      }
    }
  }

  return [...found];
}
