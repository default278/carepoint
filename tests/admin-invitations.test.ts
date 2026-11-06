import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createAdminInvitationsRouter } from '../server/admin-invitations.js';

async function postInvitation(
  dependencies: Parameters<typeof createAdminInvitationsRouter>[0],
  body: unknown,
  token?: string,
) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/invitations', createAdminInvitationsRouter(dependencies));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/admin/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('admin invitation requires an authenticated session and valid email', async () => {
  const dependencies = {
    enabled: true,
    getUserByAccessToken: async () => ({ id: 'admin-user' }),
    isAdmin: async () => true,
    inviteUser: async () => 'invited-user',
  };
  const noToken = await postInvitation(dependencies, { email: 'person@example.com' });
  assert.equal(noToken.status, 401);

  const invalidEmail = await postInvitation(dependencies, { email: 'not-an-email' }, 'valid-token');
  assert.equal(invalidEmail.status, 400);
});

test('admin invitation rejects non-admin users without inviting', async () => {
  let inviteCalled = false;
  const response = await postInvitation({
    enabled: true,
    getUserByAccessToken: async () => ({ id: 'regular-user' }),
    isAdmin: async () => false,
    inviteUser: async () => {
      inviteCalled = true;
      return 'unexpected-user';
    },
  }, { email: 'person@example.com' }, 'valid-token');

  assert.equal(response.status, 403);
  assert.equal(inviteCalled, false);
});

test('admin invitation normalizes email and returns pending role-assignment guidance', async () => {
  let invitedEmail = '';
  let verifiedAuthorization: { userId: string; token: string } | null = null;
  const response = await postInvitation({
    enabled: true,
    getUserByAccessToken: async () => ({ id: 'admin-user' }),
    isAdmin: async (userId, token) => {
      verifiedAuthorization = { userId, token };
      return userId === 'admin-user';
    },
    inviteUser: async (email) => {
      invitedEmail = email;
      return 'invited-user';
    },
  }, { email: ' New.User@Example.com ' }, 'valid-token');

  assert.equal(response.status, 202);
  assert.equal(invitedEmail, 'new.user@example.com');
  assert.deepEqual(verifiedAuthorization, { userId: 'admin-user', token: 'valid-token' });
  assert.deepEqual(await response.json(), {
    ok: true,
    invitedUserId: 'invited-user',
    message: 'Invitation sent. Assign a database role after the invited account profile is available.',
  });
});

test('staff provisioning is disabled by default and cannot send an invitation', async () => {
  let inviteCalled = false;
  const dependencies = {
    getUserByAccessToken: async () => ({ id: 'admin-user' }),
    isAdmin: async () => true,
    inviteUser: async () => {
      inviteCalled = true;
      return 'unexpected-user';
    },
  };
  const statusApp = express();
  statusApp.use(express.json());
  statusApp.use('/api/admin/invitations', createAdminInvitationsRouter(dependencies));
  const server = statusApp.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const status = await fetch(`http://127.0.0.1:${address.port}/api/admin/invitations/status`);
    assert.deepEqual(await status.json(), {
      enabled: false,
      reason: 'Staff invitations are disabled until database and authorization prerequisites are verified.',
    });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/invitations`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com' }),
    });
    assert.equal(response.status, 503);
    assert.equal(inviteCalled, false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
