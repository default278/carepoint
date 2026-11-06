import express from 'express';

export function createAdminInvitationsRouter({
  getUserByAccessToken,
  isAdmin,
  inviteUser,
  enabled = false,
}) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({
      enabled,
      reason: enabled
        ? null
        : 'Staff invitations are disabled until database and authorization prerequisites are verified.',
    });
  });

  router.post('/', async (req, res) => {
    if (!enabled) {
      return res.status(503).json({
        ok: false,
        error: 'Staff invitations are disabled until database and authorization prerequisites are verified.',
      });
    }

    const authorization = req.get('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
    if (!token) {
      return res.status(401).json({ ok: false, error: 'A valid signed-in session is required.' });
    }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    }

    try {
      const user = await getUserByAccessToken(token);
      if (!user) {
        return res.status(401).json({ ok: false, error: 'The signed-in session is invalid or expired.' });
      }

      if (!(await isAdmin(user.id, token))) {
        return res.status(403).json({ ok: false, error: 'Only an administrator can invite users.' });
      }

      const invitedUserId = await inviteUser(email);
      return res.status(202).json({
        ok: true,
        invitedUserId,
        message: 'Invitation sent. Assign a database role after the invited account profile is available.',
      });
    } catch (error) {
      console.error('[BACKEND] Admin invitation failed:', error instanceof Error ? error.message : 'Unknown error');
      return res.status(502).json({
        ok: false,
        error: 'The invitation request could not be completed. Check server configuration, database availability, and Auth email delivery.',
      });
    }
  });

  return router;
}
