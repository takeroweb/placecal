// Category / Job / Template / Event / Earnings routes. Every query is scoped by req.user.id (from the session).
// Resources owned by another user are reported as "not found" so their existence is not leaked.
import crypto from 'node:crypto';
import { Router } from 'express';
import { bad, notFound } from './errors.js';
import { tx } from './db.js';
import * as v from './validate.js';
import { summarizeEarnings, payPeriod } from './earnings.js';

const now = () => new Date().toISOString();

const toCategory = (r) => ({
  categoryId: r.id, userId: r.user_id, name: r.name, color: r.color,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const toJob = (r) => ({
  jobId: r.id, userId: r.user_id, name: r.name, hourlyWage: r.hourly_wage, transportFee: r.transport_fee,
  color: r.color, closingDay: r.closing_day, payDay: r.pay_day, payMonthOffset: r.pay_month_offset,
  breakRules: JSON.parse(r.break_rules || '[]'),
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const toFolder = (r) => ({
  folderId: r.id, userId: r.user_id, parentId: r.parent_id, name: r.name,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const toTemplate = (r) => ({
  templateId: r.id, userId: r.user_id, title: r.title, categoryId: r.category_id, folderId: r.folder_id,
  jobId: r.job_id, breakMinutes: r.break_minutes,
  startTime: r.start_time, endTime: r.end_time, location: r.location, memo: r.memo,
  notificationMinutes: r.notification_minutes, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toEvent = (r) => ({
  eventId: r.id, userId: r.user_id, templateId: r.template_id, title: r.title, categoryId: r.category_id,
  jobId: r.job_id, breakMinutes: r.break_minutes,
  date: r.date, startTime: r.start_time, endTime: r.end_time, location: r.location, memo: r.memo,
  notificationMinutes: r.notification_minutes, source: r.source, batchId: r.batch_id,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function resourceRouter(db) {
  const r = Router();

  // ---------- helpers ----------
  const ownCategory = (userId, id) =>
    typeof id === 'string' && db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, userId);
  const ownTemplate = (userId, id) =>
    typeof id === 'string' && db.prepare('SELECT * FROM templates WHERE id=? AND user_id=?').get(id, userId);
  const ownFolder = (userId, id) =>
    typeof id === 'string' && db.prepare('SELECT * FROM folders WHERE id=? AND user_id=?').get(id, userId);
  /** folderId: null = top level of the List; otherwise the user's own folder. */
  const checkFolder = (userId, id) => {
    if (id === null || id === undefined || id === '') return null;
    if (!ownFolder(userId, id)) throw bad('FOLDER_NOT_FOUND', 'フォルダが見つかりません', 'folderId');
    return id;
  };
  const ownJob = (userId, id) =>
    typeof id === 'string' && db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(id, userId);
  const ownEvent = (userId, id) =>
    typeof id === 'string' && db.prepare('SELECT * FROM events WHERE id=? AND user_id=?').get(id, userId);

  /** categoryId must exist AND belong to the current user. null is allowed only when allowNull. */
  const checkCategory = (userId, id, allowNull = false) => {
    if ((id === null || id === undefined || id === '') && allowNull) return null;
    if (!ownCategory(userId, id)) throw bad('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません', 'categoryId');
    return id;
  };

  /** jobId is optional (null = not a バイト), but when given it must be the user's own. */
  const checkJob = (userId, id) => {
    if (id === null || id === undefined || id === '') return null;
    if (!ownJob(userId, id)) throw bad('JOB_NOT_FOUND', 'バイト先が見つかりません', 'jobId');
    return id;
  };

  /** Validate a full template/event-like payload (after merging with existing values on update). */
  const validateBody = (userId, b, { allowNullCategory }) => {
    const [startTime, endTime] = v.timeRange(b.startTime, b.endTime);
    return {
      title: v.title(b.title),
      categoryId: checkCategory(userId, b.categoryId, allowNullCategory),
      jobId: checkJob(userId, b.jobId),
      breakMinutes: v.breakMinutes(b.breakMinutes, startTime, endTime),
      startTime, endTime,
      location: v.text(b.location, 'location', 200),
      memo: v.text(b.memo, 'memo', 2000),
      notificationMinutes: v.notify(b.notificationMinutes),
    };
  };

  // ---------- Categories ----------
  r.get('/categories', (req, res) => {
    const rows = db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ categories: rows.map(toCategory) });
  });

  r.post('/categories', (req, res) => {
    const b = req.body ?? {};
    const name = v.title(b.name, 'name', 'カテゴリー名');
    const color = v.color(b.color);
    const id = crypto.randomUUID(), t = now();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM categories WHERE user_id=?').get(req.user.id).m;
    db.prepare('INSERT INTO categories (id,user_id,name,color,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user.id, name, color, max + 1, t, t);
    res.status(201).json({ category: toCategory(ownCategory(req.user.id, id)) });
  });

  r.put('/categories/:id', (req, res) => {
    const cur = ownCategory(req.user.id, req.params.id);
    if (!cur) throw notFound('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません');
    const b = req.body ?? {};
    const name = has(b, 'name') ? v.title(b.name, 'name', 'カテゴリー名') : cur.name;
    const color = has(b, 'color') ? v.color(b.color) : cur.color;
    db.prepare('UPDATE categories SET name=?, color=?, updated_at=? WHERE id=? AND user_id=?')
      .run(name, color, now(), cur.id, req.user.id);
    res.json({ category: toCategory(ownCategory(req.user.id, cur.id)) });
  });

  // Deleting a category NEVER deletes events/templates: FK is ON DELETE SET NULL (→ 未分類).
  r.delete('/categories/:id', (req, res) => {
    const cur = ownCategory(req.user.id, req.params.id);
    if (!cur) throw notFound('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません');
    db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(cur.id, req.user.id);
    res.json({ ok: true, categoryId: cur.id });
  });

  // ---------- Jobs (バイト先) ----------
  const JOB_COLORS = ['#2f6fde', '#0e8f8f', '#e8780c', '#8a4fd8', '#d6336c', '#1f9d55', '#c99a06', '#6b7280'];
  const jobBody = (b, cur = {}, fallbackColor) => ({
    name: has(b, 'name') || !cur.name ? v.title(b.name, 'name', 'バイト先の名前') : cur.name,
    hourlyWage: has(b, 'hourlyWage') ? v.yen(b.hourlyWage, 'hourlyWage', '時給') : cur.hourly_wage ?? 0,
    transportFee: has(b, 'transportFee') ? v.yen(b.transportFee, 'transportFee', '交通費') : cur.transport_fee ?? 0,
    color: has(b, 'color') ? v.color(b.color) : cur.color ?? fallbackColor,
    closingDay: has(b, 'closingDay') ? v.intIn(b.closingDay, 0, 28, 'closingDay', '締め日') : cur.closing_day ?? 0,
    payDay: has(b, 'payDay') ? v.intIn(b.payDay, 1, 31, 'payDay', '支給日') : cur.pay_day ?? 25,
    payMonthOffset: has(b, 'payMonthOffset') ? v.intIn(b.payMonthOffset, 0, 2, 'payMonthOffset', '支給月') : cur.pay_month_offset ?? 1,
    breakRules: has(b, 'breakRules') ? v.breakRules(b.breakRules) : JSON.parse(cur.break_rules || '[]'),
  });

  r.get('/jobs', (req, res) => {
    const rows = db.prepare('SELECT * FROM jobs WHERE user_id=? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ jobs: rows.map(toJob) });
  });

  r.post('/jobs', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) n FROM jobs WHERE user_id=?').get(req.user.id).n;
    const d = jobBody(req.body ?? {}, {}, JOB_COLORS[count % JOB_COLORS.length]);
    const id = crypto.randomUUID(), t = now();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM jobs WHERE user_id=?').get(req.user.id).m;
    db.prepare(`INSERT INTO jobs (id,user_id,name,hourly_wage,transport_fee,color,closing_day,pay_day,pay_month_offset,
                break_rules,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, d.name, d.hourlyWage, d.transportFee, d.color, d.closingDay, d.payDay, d.payMonthOffset,
        JSON.stringify(d.breakRules), max + 1, t, t);
    res.status(201).json({ job: toJob(ownJob(req.user.id, id)) });
  });

  r.put('/jobs/:id', (req, res) => {
    const cur = ownJob(req.user.id, req.params.id);
    if (!cur) throw notFound('JOB_NOT_FOUND', 'バイト先が見つかりません');
    const d = jobBody(req.body ?? {}, cur);
    db.prepare(`UPDATE jobs SET name=?, hourly_wage=?, transport_fee=?, color=?, closing_day=?, pay_day=?, pay_month_offset=?,
                break_rules=?, updated_at=? WHERE id=? AND user_id=?`)
      .run(d.name, d.hourlyWage, d.transportFee, d.color, d.closingDay, d.payDay, d.payMonthOffset,
        JSON.stringify(d.breakRules), now(), cur.id, req.user.id);
    res.json({ job: toJob(ownJob(req.user.id, cur.id)) });
  });

  // Templates/events are kept; their job_id becomes NULL (ON DELETE SET NULL).
  r.delete('/jobs/:id', (req, res) => {
    const cur = ownJob(req.user.id, req.params.id);
    if (!cur) throw notFound('JOB_NOT_FOUND', 'バイト先が見つかりません');
    db.prepare('DELETE FROM jobs WHERE id=? AND user_id=?').run(cur.id, req.user.id);
    res.json({ ok: true, jobId: cur.id });
  });

  // ---------- Earnings ----------
  /**
   * GET /earnings?month=YYYY-MM — 給料 per job for the pay period that closes in that month
   * (e.g. 15日締め → 9/16〜10/15 for 2026-10), computed from the job's current wage.
   */
  const earningsFor = (userId, month) => {
    const jobs = db.prepare('SELECT * FROM jobs WHERE user_id=? ORDER BY sort_order, created_at').all(userId).map(toJob);
    const q = db.prepare(`SELECT * FROM events WHERE user_id=? AND job_id=? AND date BETWEEN ? AND ?
                          ORDER BY date, start_time`);
    const events = jobs.flatMap((j) => {
      const p = payPeriod(j, month);
      return q.all(userId, j.jobId, p.start, p.end).map(toEvent);
    });
    return { month, ...summarizeEarnings(jobs, events, month) };
  };

  r.get('/earnings', (req, res) => {
    res.json(earningsFor(req.user.id, v.month(req.query.month)));
  });

  // ---------- Widget (iPhone / Scriptable) ----------
  /**
   * GET /widget — everything a home-screen widget needs in one small response:
   * the next shift (バイト), the next 7 days of events, and this month's 給料見込み.
   * "Now" is the server's local time (the server runs on the user's own machine).
   */
  r.get('/widget', (req, res) => {
    const userId = req.user.id;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymdOf = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    const today = ymdOf(d);
    const nowTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const last = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    const cats = new Map(db.prepare('SELECT id, color FROM categories WHERE user_id=?').all(userId).map((c) => [c.id, c.color]));
    const jobs = new Map(db.prepare('SELECT * FROM jobs WHERE user_id=?').all(userId).map((j) => [j.id, toJob(j)]));
    const rows = db.prepare(`SELECT * FROM events WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date, start_time IS NOT NULL, start_time`)
      .all(userId, today, ymdOf(last)).map(toEvent);
    const color = (e) => (e.jobId && jobs.get(e.jobId)?.color) || cats.get(e.categoryId) || '#6b7280';
    const slim = (e) => ({ title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, color: color(e), jobName: e.jobId ? jobs.get(e.jobId)?.name ?? null : null });

    // Next shift: the first job event that hasn't ended yet (look up to 60 days ahead).
    const next = db.prepare(`SELECT * FROM events WHERE user_id=? AND job_id IS NOT NULL AND date BETWEEN ? AND ?
                             ORDER BY date, start_time`).all(userId, today, ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 60)))
      .map(toEvent).find((e) => e.date > today || !e.endTime || e.endTime > nowTime);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
      days.push({ date, events: rows.filter((e) => e.date === date).map(slim) });
    }
    const month = today.slice(0, 7);
    const earn = earningsFor(userId, month);
    res.json({
      today, now: nowTime,
      nextShift: next ? slim(next) : null,
      days,
      salary: { month, total: earn.total, minutes: earn.minutes, shifts: earn.shifts },
    });
  });

  // ---------- Folders (List) ----------
  const MAX_DEPTH = 6;
  const depthOf = (userId, id) => { let d = 0; for (let f = ownFolder(userId, id); f; f = ownFolder(userId, f.parent_id)) d++; return d; };

  r.get('/folders', (req, res) => {
    const rows = db.prepare('SELECT * FROM folders WHERE user_id=? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ folders: rows.map(toFolder) });
  });

  r.post('/folders', (req, res) => {
    const b = req.body ?? {};
    const name = v.title(b.name, 'name', 'フォルダ名');
    const parentId = checkFolder(req.user.id, b.parentId);
    if (parentId && depthOf(req.user.id, parentId) >= MAX_DEPTH) throw bad('TOO_DEEP', `フォルダは${MAX_DEPTH}階層までです`, 'parentId');
    const id = crypto.randomUUID(), t = now();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM folders WHERE user_id=?').get(req.user.id).m;
    db.prepare('INSERT INTO folders (id,user_id,parent_id,name,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user.id, parentId, name, max + 1, t, t);
    res.status(201).json({ folder: toFolder(ownFolder(req.user.id, id)) });
  });

  r.put('/folders/:id', (req, res) => {
    const cur = ownFolder(req.user.id, req.params.id);
    if (!cur) throw notFound('FOLDER_NOT_FOUND', 'フォルダが見つかりません');
    const b = req.body ?? {};
    const name = has(b, 'name') ? v.title(b.name, 'name', 'フォルダ名') : cur.name;
    let parentId = cur.parent_id;
    if (has(b, 'parentId')) {
      parentId = checkFolder(req.user.id, b.parentId);
      // A folder can't move into itself or one of its own subfolders.
      for (let f = parentId && ownFolder(req.user.id, parentId); f; f = ownFolder(req.user.id, f.parent_id)) {
        if (f.id === cur.id) throw bad('INVALID_PARENT', 'フォルダを自分の中には移動できません', 'parentId');
      }
    }
    db.prepare('UPDATE folders SET name=?, parent_id=?, updated_at=? WHERE id=? AND user_id=?')
      .run(name, parentId, now(), cur.id, req.user.id);
    res.json({ folder: toFolder(ownFolder(req.user.id, cur.id)) });
  });

  // Deleting a folder never deletes templates: its contents move up to the parent folder.
  r.delete('/folders/:id', (req, res) => {
    const cur = ownFolder(req.user.id, req.params.id);
    if (!cur) throw notFound('FOLDER_NOT_FOUND', 'フォルダが見つかりません');
    tx(db, () => {
      db.prepare('UPDATE templates SET folder_id=? WHERE folder_id=? AND user_id=?').run(cur.parent_id, cur.id, req.user.id);
      db.prepare('UPDATE folders SET parent_id=? WHERE parent_id=? AND user_id=?').run(cur.parent_id, cur.id, req.user.id);
      db.prepare('DELETE FROM folders WHERE id=? AND user_id=?').run(cur.id, req.user.id);
    });
    res.json({ ok: true, folderId: cur.id });
  });

  // ---------- Templates ----------
  r.get('/templates', (req, res) => {
    const rows = db.prepare('SELECT * FROM templates WHERE user_id=? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ templates: rows.map(toTemplate) });
  });

  r.post('/templates', (req, res) => {
    const d = validateBody(req.user.id, req.body ?? {}, { allowNullCategory: false });
    const folderId = checkFolder(req.user.id, req.body?.folderId);
    const id = crypto.randomUUID(), t = now();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM templates WHERE user_id=?').get(req.user.id).m;
    db.prepare(`INSERT INTO templates (id,user_id,title,category_id,folder_id,job_id,break_minutes,start_time,end_time,location,memo,
                notification_minutes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, d.title, d.categoryId, folderId, d.jobId, d.breakMinutes, d.startTime, d.endTime, d.location, d.memo,
        d.notificationMinutes, max + 1, t, t);
    res.status(201).json({ template: toTemplate(ownTemplate(req.user.id, id)) });
  });

  /** PUT /templates/order { templateIds: [...] } — tray order after drag & drop. */
  r.put('/templates/order', (req, res) => {
    const ids = req.body?.templateIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) {
      throw bad('VALIDATION_ERROR', '並び順の指定が正しくありません', 'templateIds');
    }
    if (!ids.every((id) => ownTemplate(req.user.id, id))) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません');
    const upd = db.prepare('UPDATE templates SET sort_order=? WHERE id=? AND user_id=?');
    tx(db, () => ids.forEach((id, i) => upd.run(i, id, req.user.id)));
    const rows = db.prepare('SELECT * FROM templates WHERE user_id=? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ templates: rows.map(toTemplate) });
  });

  r.put('/templates/:id', (req, res) => {
    const cur = ownTemplate(req.user.id, req.params.id);
    if (!cur) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません');
    const merged = { ...toTemplate(cur), ...(req.body ?? {}) };
    const d = validateBody(req.user.id, merged, { allowNullCategory: !has(req.body ?? {}, 'categoryId') });
    const folderId = has(req.body ?? {}, 'folderId') ? checkFolder(req.user.id, req.body.folderId) : cur.folder_id;
    db.prepare(`UPDATE templates SET title=?,category_id=?,folder_id=?,job_id=?,break_minutes=?,start_time=?,end_time=?,location=?,memo=?,
                notification_minutes=?,updated_at=? WHERE id=? AND user_id=?`)
      .run(d.title, d.categoryId, folderId, d.jobId, d.breakMinutes, d.startTime, d.endTime, d.location, d.memo, d.notificationMinutes, now(),
        cur.id, req.user.id);
    res.json({ template: toTemplate(ownTemplate(req.user.id, cur.id)) });
  });

  // Existing events keep their copied values; their template_id becomes NULL.
  r.delete('/templates/:id', (req, res) => {
    const cur = ownTemplate(req.user.id, req.params.id);
    if (!cur) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません');
    db.prepare('DELETE FROM templates WHERE id=? AND user_id=?').run(cur.id, req.user.id);
    res.json({ ok: true, templateId: cur.id });
  });

  // ---------- Events ----------
  r.get('/events', (req, res) => {
    const start = v.reqDate(req.query.start, 'start');
    const end = v.reqDate(req.query.end, 'end');
    if (start > end) throw bad('INVALID_RANGE', '開始日は終了日以前にしてください', 'end');
    const days = (Date.parse(end) - Date.parse(start)) / 86400e3;
    if (days > 400) throw bad('INVALID_RANGE', '取得期間は400日以内にしてください', 'end');
    const rows = db.prepare(`SELECT * FROM events WHERE user_id=? AND date BETWEEN ? AND ?
                             ORDER BY date, start_time, created_at`).all(req.user.id, start, end);
    res.json({ events: rows.map(toEvent) });
  });

  const insertEvent = (userId, d, extra) => {
    const id = crypto.randomUUID(), t = now();
    db.prepare(`INSERT INTO events (id,user_id,template_id,title,category_id,job_id,break_minutes,date,start_time,end_time,location,memo,
                notification_minutes,source,batch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, extra.templateId ?? null, d.title, d.categoryId, d.jobId, d.breakMinutes, extra.date, d.startTime, d.endTime,
        d.location, d.memo, d.notificationMinutes, extra.source, extra.batchId ?? null, t, t);
    return toEvent(ownEvent(userId, id));
  };

  const copyOf = (tpl) => ({
    title: tpl.title, categoryId: tpl.category_id, jobId: tpl.job_id, breakMinutes: tpl.break_minutes,
    startTime: tpl.start_time, endTime: tpl.end_time, location: tpl.location, memo: tpl.memo, notificationMinutes: tpl.notification_minutes,
  });

  /**
   * POST /events
   *  - { templateId, date }  → the core "place a template" flow: server copies the template.
   *  - { title, categoryId, date, startTime, endTime, ... } → manual event.
   */
  r.post('/events', (req, res) => {
    const b = req.body ?? {};
    const userId = req.user.id;
    if (b.templateId !== undefined && b.templateId !== null) {
      const date = v.reqDate(b.date);
      const tpl = ownTemplate(userId, b.templateId);
      if (!tpl) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません');
      return res.status(201).json({ event: insertEvent(userId, copyOf(tpl), { templateId: tpl.id, date, source: 'template' }) });
    }
    const date = v.reqDate(b.date);
    const d = validateBody(userId, b, { allowNullCategory: false });
    res.status(201).json({ event: insertEvent(userId, d, { date, source: 'manual' }) });
  });

  /**
   * POST /events/bulk { templateId | (title, categoryId, startTime, endTime, ...), startDate, endDate, weekdays? }
   * Places a template on every date in the range (optionally only on the given weekdays, 0=Sun..6=Sat).
   * All events share one batchId so the whole placement can be undone at once.
   */
  r.post('/events/bulk', (req, res) => {
    const b = req.body ?? {};
    const userId = req.user.id;
    // With templateId: copy the template. Without: a typed event repeated over the range (予定を追加 with 終了日).
    let tpl = null;
    if (b.templateId !== undefined && b.templateId !== null) {
      tpl = ownTemplate(userId, b.templateId);
      if (!tpl) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません');
    }
    const d = tpl ? copyOf(tpl) : validateBody(userId, b, { allowNullCategory: false });
    const dates = v.dateList(b.startDate, b.endDate, b.weekdays);
    const batchId = crypto.randomUUID();
    const events = tx(db, () => dates.map((date) =>
      insertEvent(userId, d, { templateId: tpl?.id ?? null, date, source: 'bulk', batchId })));
    res.status(201).json({ events, batchId });
  });

  // Undo for a bulk placement.
  r.delete('/events/batch/:batchId', (req, res) => {
    const info = db.prepare('DELETE FROM events WHERE batch_id=? AND user_id=?').run(req.params.batchId, req.user.id);
    if (!info.changes) throw notFound('BATCH_NOT_FOUND', '取り消す予定が見つかりません');
    res.json({ ok: true, deleted: Number(info.changes) });
  });

  r.put('/events/:id', (req, res) => {
    const userId = req.user.id;
    const cur = ownEvent(userId, req.params.id);
    if (!cur) throw notFound('EVENT_NOT_FOUND', '予定が見つかりません');
    const body = req.body ?? {};
    const merged = { ...toEvent(cur), ...body };
    const date = v.reqDate(merged.date);
    const d = validateBody(userId, merged, { allowNullCategory: !has(body, 'categoryId') });
    db.prepare(`UPDATE events SET title=?,category_id=?,job_id=?,break_minutes=?,date=?,start_time=?,end_time=?,location=?,memo=?,
                notification_minutes=?,updated_at=? WHERE id=? AND user_id=?`)
      .run(d.title, d.categoryId, d.jobId, d.breakMinutes, date, d.startTime, d.endTime, d.location, d.memo, d.notificationMinutes, now(),
        cur.id, userId);
    res.json({ event: toEvent(ownEvent(userId, cur.id)) });
  });

  r.delete('/events/:id', (req, res) => {
    const cur = ownEvent(req.user.id, req.params.id);
    if (!cur) throw notFound('EVENT_NOT_FOUND', '予定が見つかりません');
    db.prepare('DELETE FROM events WHERE id=? AND user_id=?').run(cur.id, req.user.id);
    res.json({ ok: true, eventId: cur.id });
  });

  return r;
}
