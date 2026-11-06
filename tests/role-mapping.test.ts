import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAssignedRoles } from '../src/lib/role-mapping.ts';

test('extracts valid roles from array-shaped assignments and role relationships', () => {
  assert.deepEqual(
    extractAssignedRoles([
      { roles: [{ name: 'admin' }] },
      { roles: { name: 'doctor' } },
      { roles: null },
    ]),
    ['admin', 'doctor'],
  );
});

test('accepts a singleton assignment and nested role object', () => {
  assert.deepEqual(
    extractAssignedRoles({ roles: { name: 'admin' } }),
    ['admin'],
  );
});

test('handles null, absent, malformed, and unrecognized role data', () => {
  assert.deepEqual(extractAssignedRoles(null), []);
  assert.deepEqual(extractAssignedRoles(undefined), []);
  assert.deepEqual(extractAssignedRoles({ roles: { name: 'super_admin' } }), []);
  assert.deepEqual(extractAssignedRoles({ roles: 'admin' }), []);
});

test('deduplicates assignments without losing admin', () => {
  assert.deepEqual(
    extractAssignedRoles([
      { roles: { name: 'admin' } },
      { roles: [{ name: 'admin' }] },
    ]),
    ['admin'],
  );
});
