import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_HOURS = 12;
const attempts = new Map();

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, salt, expected] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const cookies = (request) => Object.fromEntries(String(request.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((item) => item.length === 2));

export function createAuth(db, { passwordHash = process.env.ADMIN_PASSWORD_HASH, production = process.env.NODE_ENV === 'production' } = {}) {
  const cookieAttributes = `HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${production ? '; Secure' : ''}`;

  function cleanup(now = new Date()) {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now.toISOString());
  }

  function session(request) {
    cleanup();
    const token = cookies(request).zahra_admin_session;
    if (!token) return null;
    const row = db.prepare('SELECT token_hash AS tokenHash, expires_at AS expiresAt FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash(token), new Date().toISOString());
    if (!row) return null;
    db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), row.tokenHash);
    return row;
  }

  function login(request, response, password) {
    if (!passwordHash) throw new Error('Admin-Passwort ist noch nicht eingerichtet.');
    const client = request.socket.remoteAddress || 'unknown';
    const state = attempts.get(client) || { count: 0, blockedUntil: 0 };
    if (state.blockedUntil > Date.now()) throw new Error('Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.');
    if (!verifyPassword(password || '', passwordHash)) {
      state.count += 1;
      if (state.count >= 5) { state.blockedUntil = Date.now() + 5 * 60_000; state.count = 0; }
      attempts.set(client, state);
      throw new Error('Passwort ist nicht korrekt.');
    }
    attempts.delete(client);
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
    db.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?)')
      .run(tokenHash(token), expires.toISOString(), now.toISOString(), now.toISOString());
    response.setHeader('Set-Cookie', `zahra_admin_session=${encodeURIComponent(token)}; ${cookieAttributes}`);
  }

  function logout(request, response) {
    const token = cookies(request).zahra_admin_session;
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token));
    response.setHeader('Set-Cookie', `zahra_admin_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`);
  }

  return { session, login, logout, configured: Boolean(passwordHash) };
}
