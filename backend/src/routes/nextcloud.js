import { Router } from 'express';
import { query } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { imapManager } from '../index.js';
import { isEnabled, testConnection, listDirectory, downloadFile, uploadFile } from '../services/nextcloudClient.js';

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches mail.js's safeFilename — sanitizes a filename for safe use as a path segment.
function safeFilename(name) {
  if (!name) return 'attachment';
  const cleaned = String(name)
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex -- intentionally stripping control characters
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[‪-‮⁦-⁩‏؜]/g, '')
    .trim()
    .substring(0, 255);
  return cleaned || 'attachment';
}

async function getNextcloudCreds(userId) {
  const result = await query(
    "SELECT config FROM user_integrations WHERE user_id = $1 AND provider = 'nextcloud'",
    [userId]
  );
  if (!result.rows.length) {
    throw Object.assign(new Error('Nextcloud not connected'), { status: 409 });
  }
  const { username, password } = result.rows[0].config;
  return { username, password: decrypt(password) };
}

// GET /api/nextcloud/status
router.get('/status', async (req, res) => {
  try {
    const result = await query(
      "SELECT id FROM user_integrations WHERE user_id = $1 AND provider = 'nextcloud'",
      [req.session.userId]
    );
    res.json({ enabled: isEnabled(), connected: result.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nextcloud/connect
router.post('/connect', async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ error: 'Nextcloud integration is not configured on this server' });
  }
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'App password is required' });
  }
  const trimmedUser = username.trim();

  try {
    await testConnection(trimmedUser, password);

    await query(`
      INSERT INTO user_integrations (user_id, provider, config)
      VALUES ($1, 'nextcloud', $2)
      ON CONFLICT (user_id, provider) DO UPDATE
      SET config = EXCLUDED.config, updated_at = NOW()
    `, [req.session.userId, { username: trimmedUser, password: encrypt(password) }]);

    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/nextcloud/disconnect
router.delete('/disconnect', async (req, res) => {
  try {
    await query(
      "DELETE FROM user_integrations WHERE user_id = $1 AND provider = 'nextcloud'",
      [req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nextcloud/list?path=/some/folder
router.get('/list', async (req, res) => {
  try {
    const { username, password } = await getNextcloudCreds(req.session.userId);
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    const entries = await listDirectory(username, password, path);
    res.json({ entries });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/nextcloud/download?path=/some/file.pdf
// Returns the file in the same shape ComposeModal already uses for locally-picked attachments.
const DOWNLOAD_SIZE_LIMIT = 25 * 1024 * 1024; // 25 MB — matches the compose-time attachment cap
router.get('/download', async (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path) return res.status(400).json({ error: 'path is required' });
  try {
    const { username, password } = await getNextcloudCreds(req.session.userId);
    const { buffer, contentType } = await downloadFile(username, password, path, { maxBytes: DOWNLOAD_SIZE_LIMIT });
    res.json({
      name: path.split('/').filter(Boolean).pop() || 'file',
      size: buffer.length,
      type: contentType,
      data: buffer.toString('base64'),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/nextcloud/upload  { messageId, part, folderPath }
// Fetches the attachment bytes from IMAP (reusing imapManager.fetchAttachment,
// the same helper mail.js's attachment-download route uses) and PUTs them to Nextcloud.
const UPLOAD_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB — matches mail.js's attachment download limit
router.post('/upload', async (req, res) => {
  const { messageId, part, folderPath } = req.body;
  if (!UUID_RE.test(messageId || '')) return res.status(400).json({ error: 'Invalid message id' });
  if (!part) return res.status(400).json({ error: 'part is required' });

  try {
    const { username, password } = await getNextcloudCreds(req.session.userId);

    const result = await query(`
      SELECT m.*, a.user_id FROM messages m
      JOIN email_accounts a ON m.account_id = a.id
      WHERE m.id = $1 AND a.user_id = $2
    `, [messageId, req.session.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Message not found' });
    const message = result.rows[0];

    const attachments = typeof message.attachments === 'string'
      ? JSON.parse(message.attachments || '[]')
      : (message.attachments || []);
    const att = attachments.find(a => a.part === part);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    if (att.size > UPLOAD_SIZE_LIMIT) {
      return res.status(413).json({ error: 'Attachment exceeds the 50 MB Nextcloud upload limit.' });
    }

    const accountResult = await query('SELECT * FROM email_accounts WHERE id = $1', [message.account_id]);
    if (!accountResult.rows.length) return res.status(404).json({ error: 'Account not found' });
    const buffer = await imapManager.fetchAttachment(accountResult.rows[0], message.uid, message.folder, part);
    if (!buffer) return res.status(404).json({ error: 'Could not fetch attachment' });

    const filename = safeFilename(att.filename);
    const targetPath = `${folderPath || ''}/${filename}`;
    await uploadFile(username, password, targetPath, buffer, att.type || 'application/octet-stream');

    res.json({ ok: true, path: targetPath });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
