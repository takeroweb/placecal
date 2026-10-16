import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DB_FILE = process.env.DB_FILE || path.join(here, '..', 'data', 'placecal.db');
// 'local' (default): no login, single user. 'password': email/password accounts.
const AUTH_MODE = process.env.AUTH_MODE === 'password' ? 'password' : 'local';
const PROD = process.env.NODE_ENV === 'production';

const db = openDb(DB_FILE);
const app = createApp(db, {
  secureCookie: PROD,
  authMode: AUTH_MODE,
  // Personal server: after the first account, sign-up closes unless ALLOW_SIGNUP=1.
  allowSignup: process.env.ALLOW_SIGNUP === '1',
  trustProxy: PROD,
  staticDir: path.join(here, '..', '..', 'web', 'dist'),
});

app.listen(PORT, () => console.log(`PlaceCal API listening on http://localhost:${PORT} (db: ${DB_FILE}, auth: ${AUTH_MODE})`));
