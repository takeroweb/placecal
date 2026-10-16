import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter, requireAuth } from './auth.js';
import { resourceRouter } from './resources.js';
import { errorHandler, ApiError } from './errors.js';

const SCRIPTABLE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scriptable', 'PlaceCal.js');

export function createApp(db, { secureCookie = false, staticDir, authMode = 'password', allowSignup = true, trustProxy = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (HTTPS terminated there): trust it for req.ip / req.protocol.
  if (trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  // Basic CSRF guard: state-changing API calls must be JSON (forms can't send that cross-site without CORS).
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers['content-length'] !== '0'
        && req.headers['content-type'] && !req.is('application/json')) {
      return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json で送信してください'));
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // iPhone widget: open this in Safari on the phone and copy it into Scriptable.
  // The server address the phone used is filled in, so no editing is needed.
  app.get('/scriptable/PlaceCal.js', (req, res, next) => {
    fs.readFile(SCRIPTABLE_FILE, 'utf8', (err, src) => {
      if (err) return next(new ApiError(404, 'NOT_FOUND', 'スクリプトが見つかりません'));
      // ?token=… (from the app's account menu) is embedded so the widget works on a login-protected server.
      const token = typeof req.query.token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(req.query.token) ? req.query.token : '';
      res.set('Cache-Control', 'no-store');
      res.type('text/plain; charset=utf-8').send(src
        .replace('__SERVER__', `${req.protocol}://${req.get('host')}`)
        .replace('__TOKEN__', token));
    });
  });
  app.use('/api/auth', authRouter(db, { secureCookie, mode: authMode, allowSignup }));
  app.use('/api', requireAuth(db, { mode: authMode }), resourceRouter(db));
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'APIが見つかりません')));

  // Production: serve the built frontend.
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
