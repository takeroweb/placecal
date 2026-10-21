// SQLite access layer. Uses Node's built-in `node:sqlite` so no native build is needed.
// SQL is kept close to standard so a later move to PostgreSQL is mostly mechanical.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,           -- sha256 of the cookie token; raw token never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

-- バイト先. Templates/events point here so shifts with different hours count as the same job.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  hourly_wage   INTEGER NOT NULL DEFAULT 0,   -- 円/時
  transport_fee INTEGER NOT NULL DEFAULT 0,   -- 円/勤務日（往復）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

-- List のフォルダ（入れ子可）: e.g. バイト › ホテル › (17:00〜22:00, 10:00〜15:00 …)
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS templates (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  category_id          TEXT REFERENCES categories(id) ON DELETE SET NULL,
  start_time           TEXT,              -- 'HH:MM' or NULL (= 終日 / 時間なし)
  end_time             TEXT,
  location             TEXT NOT NULL DEFAULT '',
  memo                 TEXT NOT NULL DEFAULT '',
  notification_minutes INTEGER,           -- NULL = 通知なし
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);

-- Event is a full COPY of template values. template_id is only provenance:
-- editing/deleting a template never touches existing events.
CREATE TABLE IF NOT EXISTS events (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id          TEXT REFERENCES templates(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  category_id          TEXT REFERENCES categories(id) ON DELETE SET NULL,
  date                 TEXT NOT NULL,     -- 'YYYY-MM-DD'
  start_time           TEXT,
  end_time             TEXT,
  location             TEXT NOT NULL DEFAULT '',
  memo                 TEXT NOT NULL DEFAULT '',
  notification_minutes INTEGER,
  source               TEXT NOT NULL DEFAULT 'manual', -- 'template' | 'manual' | 'bulk' | 'recurrence' | 'day_set' | 'ai_import'
  recurrence_rule_id   TEXT,              -- future: set when generated from a recurrence rule
  batch_id             TEXT,              -- future: groups events created by one bulk / day-set / AI import action
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);

-- ---- Future extensions (tables exist so later phases need no destructive migration) ----

-- Recurring placement of a template, e.g. RRULE 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
-- or 'FREQ=MONTHLY;BYDAY=2SA'. Events are materialized from it.
CREATE TABLE IF NOT EXISTS recurrence_rules (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  rrule       TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 「1日のセット」: a named list of templates placed together on one date.
CREATE TABLE IF NOT EXISTS day_sets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_set_items (
  id          TEXT PRIMARY KEY,
  day_set_id  TEXT NOT NULL REFERENCES day_sets(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Notification delivery queue for a future worker (push / email).
CREATE TABLE IF NOT EXISTS notification_jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  notify_at  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`;

// Columns added after the first release. Applied to existing databases without touching data.
const ADDED_COLUMNS = [
  ['templates', 'folder_id', 'TEXT REFERENCES folders(id) ON DELETE SET NULL'], // List のフォルダ (NULL = 一番上)
  ['templates', 'job_id', 'TEXT REFERENCES jobs(id) ON DELETE SET NULL'],
  ['templates', 'break_minutes', 'INTEGER NOT NULL DEFAULT 0'], // 休憩（時給が発生しない時間）
  ['events', 'job_id', 'TEXT REFERENCES jobs(id) ON DELETE SET NULL'],
  ['events', 'break_minutes', 'INTEGER NOT NULL DEFAULT 0'],
  // 給料ページ: color for the job, pay period (締め日) and payday (支給日).
  ['jobs', 'color', "TEXT NOT NULL DEFAULT '#2f6fde'"],
  ['jobs', 'closing_day', 'INTEGER NOT NULL DEFAULT 0'],      // 0 = 末日締め, 1..28 = その日締め
  ['jobs', 'pay_day', 'INTEGER NOT NULL DEFAULT 25'],         // 1..31 (clamped to month end); 31 = 末日
  ['jobs', 'pay_month_offset', 'INTEGER NOT NULL DEFAULT 1'], // 0 = 当月, 1 = 翌月, 2 = 翌々月 (relative to 締め月)
  // 休憩ルール JSON: [{"overMinutes":360,"breakMinutes":45}, …] = 勤務6時間超→45分. Used when a shift has no explicit break.
  ['jobs', 'break_rules', "TEXT NOT NULL DEFAULT '[]'"],
  // Read-only token for the iPhone widget (Scriptable can't log in with a cookie).
  ['users', 'widget_token', 'TEXT'],
];

function migrate(db) {
  for (const [table, col, def] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_user_job ON events(user_id, job_id, date)');
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Run fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
