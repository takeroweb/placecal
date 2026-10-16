// Two modes (AUTH_MODE):
//  - 'local'    (default) no login: every request acts as the single local user. Personal use.
//  - 'password' email + password with server-side sessions in an HttpOnly cookie.
// Either way the current user is resolved on the server; no route accepts userId from the client.
import crypto from 'node:crypto';
import { Router } from 'express';
import { ApiError, bad } from './errors.js';
import { tx } from './db.js';
import { seedDefaults } from './seed.js';

const COOKIE = 'pc_session';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored.startsWith('scrypt$')) return false; // e.g. the local user, which has no password
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, token, secure) {
  const parts = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const publicUser = (u) => ({ userId: u.id, name: u.name, email: u.email, createdAt: u.created_at });

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 86400e3);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, now.toISOString(), exp.toISOString());
  return token;
}

/**
 * The single user of 'local' mode. Adopts the oldest existing account so data created before
 * login was removed stays visible; otherwise creates one with the default categories/templates.
 */
export function localUser(db) {
  const existing = db.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').get();
  if (existing) return existing;
  const id = crypto.randomUUID();
  tx(db, () => {
    db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)')
      .run(id, 'わたし', 'local@placecal.local', 'disabled', new Date().toISOString());
    seedDefaults(db, id);
  });
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

/** Widget token: 'Authorization: Bearer <token>'. Accepted ONLY for GET /api/widget (read-only). */
function bearer(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

export function widgetToken(db, userId, { rotate = false } = {}) {
  const u = db.prepare('SELECT widget_token FROM users WHERE id=?').get(userId);
  if (u?.widget_token && !rotate) return u.widget_token;
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('UPDATE users SET widget_token=? WHERE id=?').run(token, userId);
  return token;
}

/** Middleware: attaches req.user or responds 401. */
export function requireAuth(db, { mode = 'password' } = {}) {
  if (mode === 'local') {
    return (req, _res, next) => { req.user = localUser(db); next(); };
  }
  const byWidgetToken = db.prepare('SELECT * FROM users WHERE widget_token = ?');
  const stmt = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    const user = token && stmt.get(sha256(token), new Date().toISOString());
    if (!user && req.method === 'GET' && req.path === '/widget' && bearer(req)) {
      const w = byWidgetToken.get(bearer(req));
      if (w) { req.user = w; return next(); }
    }
    if (!user) return next(new ApiError(401, 'UNAUTHORIZED', 'ログインしてください'));
    req.user = user;
    req.sessionTokenHash = sha256(token);
    next();
  };
}

// Login attempts per IP: at most 10 failures in 15 minutes.
const FAIL_WINDOW = 15 * 60e3;
const FAIL_MAX = 10;

/**
 * allowSignup: false = only the FIRST account can be created (personal server on the internet).
 */
export function authRouter(db, { secureCookie = false, mode = 'password', allowSignup = true } = {}) {
  const r = Router();
  const auth = requireAuth(db, { mode });
  const fails = new Map(); // ip → [timestamps]
  const recentFails = (ip) => (fails.get(ip) ?? []).filter((t) => Date.now() - t < FAIL_WINDOW);
  const signupOpen = () => allowSignup || !db.prepare('SELECT 1 FROM users LIMIT 1').get();

  // Widget token (both modes): shown in the app's account menu, embedded in the Scriptable script.
  r.get('/widget-token', auth, (req, res) => res.json({ token: widgetToken(db, req.user.id) }));
  r.post('/widget-token/rotate', auth, (req, res) => res.json({ token: widgetToken(db, req.user.id, { rotate: true }) }));

  if (mode === 'local') {
    r.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user), authMode: 'local' }));
    r.get('/status', (_req, res) => res.json({ authMode: 'local', signupOpen: false }));
    r.use((_req, _res, next) => next(new ApiError(404, 'AUTH_DISABLED', 'このサーバーはログインなしで動作しています')));
    return r;
  }

  r.get('/status', (_req, res) => res.json({ authMode: 'password', signupOpen: signupOpen() }));

  r.post('/register', (req, res) => {
    if (!signupOpen()) throw new ApiError(403, 'SIGNUP_CLOSED', '新しいアカウントは作成できません（このサーバーは個人用です）');
    const { name, email, password } = req.body ?? {};
    const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw bad('INVALID_EMAIL', 'メールアドレスが正しくありません', 'email');
    if (typeof password !== 'string' || password.length < 8) throw bad('WEAK_PASSWORD', 'パスワードは8文字以上にしてください', 'password');
    const nm = typeof name === 'string' && name.trim() ? name.trim().slice(0, 50) : em.split('@')[0];
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 'email');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    tx(db, () => {
      db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)')
        .run(id, nm, em, hashPassword(password), now);
      seedDefaults(db, id);
    });
    setSessionCookie(res, createSession(db, id), secureCookie);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
  });

  r.post('/login', (req, res) => {
    const ip = req.ip;
    const recent = recentFails(ip);
    if (recent.length >= FAIL_MAX) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'ログインの失敗が続いたため、しばらく待ってからお試しください');
    }
    const { email, password } = req.body ?? {};
    const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
    if (!u || typeof password !== 'string' || !verifyPassword(password, u.password_hash)) {
      fails.set(ip, [...recent, Date.now()]);
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが違います');
    }
    fails.delete(ip);
    setSessionCookie(res, createSession(db, u.id), secureCookie);
    res.json({ user: publicUser(u) });
  });

  r.post('/logout', auth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  r.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user), authMode: 'password' }));

  return r;
}
