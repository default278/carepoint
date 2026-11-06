import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.STAFF_PROVISIONING_ENABLED = 'false';

const { app, relationProbeResult } = await import('../server/index.js');

test('health relation probes distinguish schema-cache errors from other failures', () => {
  assert.deepEqual(relationProbeResult(null), {
    queryable: true,
    status: 'queryable',
  });
  assert.deepEqual(relationProbeResult({
    code: 'PGRST205',
    message: "Could not find the table 'public.encounters' in the schema cache",
  }), {
    queryable: false,
    status: 'not_in_schema_cache',
    code: 'PGRST205',
    error: "Could not find the table 'public.encounters' in the schema cache",
  });
  assert.equal(relationProbeResult({
    code: '42501',
    message: 'permission denied',
  }).status, 'error');
});

test('backend exposes ping and explicit health configuration errors', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const ping = await fetch(`${baseUrl}/api/ping`);
    assert.equal(ping.status, 200);
    assert.deepEqual(await ping.json(), { ok: true, message: 'Carepoint backend is running.' });

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 500);
    const healthBody = await health.json() as { ok: boolean; error: string };
    assert.equal(healthBody.ok, false);
    assert.match(healthBody.error, /VITE_SUPABASE_(URL|ANON_KEY)/);

    const invitation = await fetch(`${baseUrl}/api/admin/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com' }),
    });
    assert.equal(invitation.status, 503);
    assert.equal((await invitation.json() as { ok: boolean }).ok, false);

    const provisioningStatus = await fetch(`${baseUrl}/api/admin/invitations/status`);
    assert.equal(provisioningStatus.status, 200);
    assert.deepEqual(await provisioningStatus.json(), {
      enabled: false,
      reason: 'Staff invitations are disabled until database and authorization prerequisites are verified.',
    });

    const missing = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, error: 'Not found' });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
