import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const app = createApp(openDb(':memory:'));

async function signup(email) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/register').send({ name: email, email, password: 'password123' });
  assert.equal(r.status, 201);
  return agent;
}

describe('auth', () => {
  test('unauthenticated requests are rejected with unified error', async () => {
    const r = await request(app).get('/api/templates');
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: { code: 'UNAUTHORIZED', message: 'ログインしてください' } });
  });
  test('register seeds 6 default categories and starter templates', async () => {
    const a = await signup('seed@example.com');
    const c = await a.get('/api/categories');
    assert.deepEqual(c.body.categories.map((x) => x.name), ['バイト', '大学', '遊び', '勉強', '運動', 'その他']);
    const t = await a.get('/api/templates');
    assert.ok(t.body.templates.length >= 3);
  });
  test('duplicate email / wrong password', async () => {
    await signup('dup@example.com');
    const r = await request(app).post('/api/auth/register').send({ email: 'dup@example.com', password: 'password123' });
    assert.equal(r.body.error.code, 'EMAIL_TAKEN');
    const l = await request(app).post('/api/auth/login').send({ email: 'dup@example.com', password: 'nope-nope' });
    assert.equal(l.status, 401);
    assert.equal(l.body.error.code, 'INVALID_CREDENTIALS');
  });
  test('logout invalidates session', async () => {
    const a = await signup('out@example.com');
    await a.post('/api/auth/logout');
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });
});

describe('templates → events (core flow)', () => {
  let a, catId, tpl;
  before(async () => {
    a = await signup('core@example.com');
    catId = (await a.get('/api/categories')).body.categories[0].categoryId;
    const r = await a.post('/api/templates').send({
      title: 'バイト', categoryId: catId, startTime: '17:00', endTime: '22:00', location: '長崎駅前店', notificationMinutes: 30,
    });
    assert.equal(r.status, 201);
    tpl = r.body.template;
  });

  test('placing {templateId, date} copies template values', async () => {
    const r = await a.post('/api/events').send({ templateId: tpl.templateId, date: '2026-10-15' });
    assert.equal(r.status, 201);
    const e = r.body.event;
    assert.equal(e.title, 'バイト');
    assert.equal(e.startTime, '17:00');
    assert.equal(e.endTime, '22:00');
    assert.equal(e.location, '長崎駅前店');
    assert.equal(e.notificationMinutes, 30);
    assert.equal(e.date, '2026-10-15');
    assert.equal(e.templateId, tpl.templateId);
    assert.equal(e.source, 'template');
  });

  test('editing the template does NOT change existing events', async () => {
    const e = (await a.post('/api/events').send({ templateId: tpl.templateId, date: '2026-10-16' })).body.event;
    await a.put(`/api/templates/${tpl.templateId}`).send({ startTime: '18:00', title: 'バイト(変更)' });
    const list = (await a.get('/api/events?start=2026-10-16&end=2026-10-16')).body.events;
    const same = list.find((x) => x.eventId === e.eventId);
    assert.equal(same.title, 'バイト');
    assert.equal(same.startTime, '17:00');
  });

  test('deleting the template keeps events', async () => {
    const t2 = (await a.post('/api/templates').send({ title: '一時', categoryId: catId })).body.template;
    const e = (await a.post('/api/events').send({ templateId: t2.templateId, date: '2026-10-20' })).body.event;
    await a.delete(`/api/templates/${t2.templateId}`);
    const list = (await a.get('/api/events?start=2026-10-20&end=2026-10-20')).body.events;
    const kept = list.find((x) => x.eventId === e.eventId);
    assert.ok(kept);
    assert.equal(kept.templateId, null);
  });

  test('GET /events returns only the requested range', async () => {
    await a.post('/api/events').send({ templateId: tpl.templateId, date: '2026-11-01' });
    const oct = (await a.get('/api/events?start=2026-10-01&end=2026-10-31')).body.events;
    assert.ok(oct.every((x) => x.date >= '2026-10-01' && x.date <= '2026-10-31'));
  });

  test('move event to another day (PUT date only)', async () => {
    const e = (await a.post('/api/events').send({ templateId: tpl.templateId, date: '2026-10-10' })).body.event;
    const r = await a.put(`/api/events/${e.eventId}`).send({ date: '2026-10-11' });
    assert.equal(r.status, 200);
    assert.equal(r.body.event.date, '2026-10-11');
    assert.equal(r.body.event.startTime, e.startTime); // other fields untouched
    assert.equal(r.body.event.title, e.title);
  });

  test('deleting a category keeps its events (category becomes null)', async () => {
    const c = (await a.post('/api/categories').send({ name: '通院', color: '#ff0000' })).body.category;
    const e = (await a.post('/api/events').send({ title: '歯医者', categoryId: c.categoryId, date: '2026-10-22', startTime: '09:00', endTime: '10:00' })).body.event;
    assert.equal((await a.delete(`/api/categories/${c.categoryId}`)).status, 200);
    const list = (await a.get('/api/events?start=2026-10-22&end=2026-10-22')).body.events;
    const kept = list.find((x) => x.eventId === e.eventId);
    assert.ok(kept);
    assert.equal(kept.categoryId, null);
  });

  test('category rename / recolor', async () => {
    const r = await a.put(`/api/categories/${catId}`).send({ name: '仕事', color: '#123ABC' });
    assert.equal(r.body.category.name, '仕事');
    assert.equal(r.body.category.color, '#123abc');
  });
});

describe('validation', () => {
  let a, catId;
  before(async () => {
    a = await signup('val@example.com');
    catId = (await a.get('/api/categories')).body.categories[0].categoryId;
  });
  const cases = [
    ['empty title', { title: '  ', startTime: '10:00', endTime: '11:00' }, 'TITLE_REQUIRED'],
    ['start >= end', { title: 'x', startTime: '12:00', endTime: '11:00' }, 'INVALID_TIME'],
    ['bad time', { title: 'x', startTime: '25:00', endTime: '26:00' }, 'INVALID_TIME'],
    ['half time', { title: 'x', startTime: '10:00' }, 'INVALID_TIME'],
    ['bad notification', { title: 'x', notificationMinutes: 7 }, 'INVALID_NOTIFICATION'],
  ];
  for (const [name, body, code] of cases) {
    test(`template: ${name}`, async () => {
      const r = await a.post('/api/templates').send({ categoryId: catId, ...body });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, code);
      assert.equal(typeof r.body.error.message, 'string');
    });
  }
  test('unknown categoryId', async () => {
    const r = await a.post('/api/templates').send({ title: 'x', categoryId: 'nope' });
    assert.equal(r.body.error.code, 'CATEGORY_NOT_FOUND');
  });
  test('invalid dates', async () => {
    const t = (await a.get('/api/templates')).body.templates[0];
    for (const date of ['2026-02-30', '2026/10/01', '', undefined]) {
      const r = await a.post('/api/events').send({ templateId: t.templateId, date });
      assert.equal(r.body.error.code, 'INVALID_DATE', String(date));
    }
    assert.equal((await a.get('/api/events?start=2026-10-31&end=2026-10-01')).body.error.code, 'INVALID_RANGE');
  });
  test('unknown templateId', async () => {
    const r = await a.post('/api/events').send({ templateId: 'nope', date: '2026-10-01' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'TEMPLATE_NOT_FOUND');
  });
  test('time-less template (終日) is allowed', async () => {
    const r = await a.post('/api/templates').send({ title: '遊び', categoryId: catId });
    assert.equal(r.status, 201);
    assert.equal(r.body.template.startTime, null);
  });
});

describe('user isolation', () => {
  let A, B, aTpl, aEvt, aCat, bCat;
  before(async () => {
    A = await signup('a@example.com');
    B = await signup('b@example.com');
    aCat = (await A.get('/api/categories')).body.categories[0];
    bCat = (await B.get('/api/categories')).body.categories[0];
    aTpl = (await A.get('/api/templates')).body.templates[0];
    aEvt = (await A.post('/api/events').send({ templateId: aTpl.templateId, date: '2026-10-05' })).body.event;
  });

  test('B cannot see A data', async () => {
    const ids = (await B.get('/api/templates')).body.templates.map((t) => t.templateId);
    assert.ok(!ids.includes(aTpl.templateId));
    const ev = (await B.get('/api/events?start=2026-10-01&end=2026-10-31')).body.events;
    assert.ok(!ev.some((e) => e.eventId === aEvt.eventId));
  });
  test('B cannot place A template', async () => {
    const r = await B.post('/api/events').send({ templateId: aTpl.templateId, date: '2026-10-06' });
    assert.equal(r.status, 404);
  });
  test('B cannot modify/delete A resources', async () => {
    assert.equal((await B.put(`/api/events/${aEvt.eventId}`).send({ date: '2026-10-07' })).status, 404);
    assert.equal((await B.delete(`/api/events/${aEvt.eventId}`)).status, 404);
    assert.equal((await B.put(`/api/templates/${aTpl.templateId}`).send({ title: 'hack' })).status, 404);
    assert.equal((await B.delete(`/api/templates/${aTpl.templateId}`)).status, 404);
    assert.equal((await B.put(`/api/categories/${aCat.categoryId}`).send({ name: 'hack' })).status, 404);
    assert.equal((await B.delete(`/api/categories/${aCat.categoryId}`)).status, 404);
  });
  test('B cannot attach A category to own template', async () => {
    const r = await B.post('/api/templates').send({ title: 'x', categoryId: aCat.categoryId });
    assert.equal(r.body.error.code, 'CATEGORY_NOT_FOUND');
  });
  test('client-supplied userId is ignored', async () => {
    const r = await B.post('/api/templates').send({ title: 'x', categoryId: bCat.categoryId, userId: aCat.userId });
    assert.equal(r.status, 201);
    assert.equal(r.body.template.userId, bCat.userId);
  });
  test('A data unchanged', async () => {
    const ev = (await A.get('/api/events?start=2026-10-05&end=2026-10-05')).body.events;
    assert.equal(ev[0].eventId, aEvt.eventId);
    assert.equal(ev[0].date, '2026-10-05');
  });
});

describe('bulk placement', () => {
  let A, B, tpl;
  before(async () => {
    A = await signup('bulk-a@example.com');
    B = await signup('bulk-b@example.com');
    tpl = (await A.get('/api/templates')).body.templates[0];
  });

  test('places the template on every day in range with a shared batchId', async () => {
    const r = await A.post('/api/events/bulk').send({ templateId: tpl.templateId, startDate: '2026-10-10', endDate: '2026-10-14' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.events.map((e) => e.date), ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
    assert.ok(r.body.events.every((e) => e.batchId === r.body.batchId && e.source === 'bulk' && e.title === tpl.title));
  });

  test('weekday filter (Mon/Wed/Fri)', async () => {
    const r = await A.post('/api/events/bulk').send({ templateId: tpl.templateId, startDate: '2026-11-02', endDate: '2026-11-08', weekdays: [1, 3, 5] });
    assert.deepEqual(r.body.events.map((e) => e.date), ['2026-11-02', '2026-11-04', '2026-11-06']);
  });

  test('undo removes the whole batch, only for the owner', async () => {
    const r = await A.post('/api/events/bulk').send({ templateId: tpl.templateId, startDate: '2026-12-01', endDate: '2026-12-03' });
    assert.equal((await B.delete(`/api/events/batch/${r.body.batchId}`)).status, 404);
    const d = await A.delete(`/api/events/batch/${r.body.batchId}`);
    assert.equal(d.body.deleted, 3);
    assert.equal((await A.get('/api/events?start=2026-12-01&end=2026-12-03')).body.events.length, 0);
  });

  test('validation', async () => {
    const bad = (body) => A.post('/api/events/bulk').send({ templateId: tpl.templateId, ...body });
    assert.equal((await bad({ startDate: '2026-10-14', endDate: '2026-10-10' })).body.error.code, 'INVALID_RANGE');
    assert.equal((await bad({ startDate: '2026-01-01', endDate: '2027-06-01' })).body.error.code, 'INVALID_RANGE');
    assert.equal((await bad({ startDate: '2026-10-31', endDate: '2026-10-01x' })).body.error.code, 'INVALID_DATE');
    assert.equal((await bad({ startDate: '2026-10-05', endDate: '2026-10-05', weekdays: [0] })).body.error.code, 'NO_DATES');
    assert.equal((await bad({ startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [9] })).body.error.code, 'VALIDATION_ERROR');
    assert.equal((await B.post('/api/events/bulk').send({ templateId: tpl.templateId, startDate: '2026-10-05', endDate: '2026-10-06' })).status, 404);
  });
});

describe('jobs & earnings', () => {
  let A, B, catId, job, t1, t2;
  before(async () => {
    A = await signup('job-a@example.com');
    B = await signup('job-b@example.com');
    catId = (await A.get('/api/categories')).body.categories[0].categoryId;
    job = (await A.post('/api/jobs').send({ name: 'カフェ', hourlyWage: 1100, transportFee: 300 })).body.job;
    // Two templates with different hours, same job → counted as the same バイト.
    t1 = (await A.post('/api/templates').send({ title: 'カフェ夜', categoryId: catId, jobId: job.jobId, startTime: '17:00', endTime: '22:00', breakMinutes: 30 })).body.template;
    t2 = (await A.post('/api/templates').send({ title: 'カフェ昼', categoryId: catId, jobId: job.jobId, startTime: '10:00', endTime: '15:00', breakMinutes: 60 })).body.template;
  });

  test('template keeps jobId/breakMinutes and placing copies them', async () => {
    assert.equal(t1.jobId, job.jobId);
    assert.equal(t1.breakMinutes, 30);
    const e = (await A.post('/api/events').send({ templateId: t1.templateId, date: '2027-01-05' })).body.event;
    assert.equal(e.jobId, job.jobId);
    assert.equal(e.breakMinutes, 30);
  });

  test('earnings: wage × (duration − break) + transport per shift, grouped by job', async () => {
    await A.post('/api/events').send({ templateId: t2.templateId, date: '2027-01-06' });
    await A.post('/api/events').send({ templateId: t2.templateId, date: '2027-02-01' }); // other month
    const r = await A.get('/api/earnings?month=2027-01');
    assert.equal(r.status, 200);
    const j = r.body.jobs.find((x) => x.jobId === job.jobId);
    // 夜: 270min → 4950, 昼: 240min → 4400, transport 300×2
    assert.equal(j.shifts, 2);
    assert.equal(j.minutes, 510);
    assert.equal(j.wage, 4950 + 4400);
    assert.equal(j.transport, 600);
    assert.equal(r.body.total, 4950 + 4400 + 600);
  });

  test('wage change is reflected; deleting the job keeps events', async () => {
    await A.put(`/api/jobs/${job.jobId}`).send({ hourlyWage: 1200 });
    const j = (await A.get('/api/earnings?month=2027-01')).body.jobs.find((x) => x.jobId === job.jobId);
    assert.equal(j.wage, 5400 + 4800);
    const tmp = (await A.post('/api/jobs').send({ name: '短期' })).body.job;
    const tt = (await A.post('/api/templates').send({ title: '短期', categoryId: catId, jobId: tmp.jobId, startTime: '09:00', endTime: '10:00' })).body.template;
    const e = (await A.post('/api/events').send({ templateId: tt.templateId, date: '2027-01-09' })).body.event;
    await A.delete(`/api/jobs/${tmp.jobId}`);
    const ev = (await A.get('/api/events?start=2027-01-09&end=2027-01-09')).body.events.find((x) => x.eventId === e.eventId);
    assert.equal(ev.jobId, null);
    assert.equal((await A.get('/api/templates')).body.templates.find((x) => x.templateId === tt.templateId).jobId, null);
  });

  test('validation', async () => {
    const tpl = (body) => A.post('/api/templates').send({ title: 'x', categoryId: catId, ...body });
    assert.equal((await tpl({ startTime: '10:00', endTime: '11:00', breakMinutes: 60 })).body.error.code, 'INVALID_BREAK');
    assert.equal((await tpl({ breakMinutes: 10 })).body.error.code, 'INVALID_BREAK');
    assert.equal((await tpl({ startTime: '10:00', endTime: '11:00', breakMinutes: -5 })).body.error.code, 'INVALID_BREAK');
    assert.equal((await tpl({ jobId: 'nope' })).body.error.code, 'JOB_NOT_FOUND');
    assert.equal((await A.post('/api/jobs').send({ name: '', hourlyWage: 1000 })).body.error.code, 'TITLE_REQUIRED');
    assert.equal((await A.post('/api/jobs').send({ name: 'x', hourlyWage: 10.5 })).body.error.code, 'INVALID_AMOUNT');
    assert.equal((await A.get('/api/earnings?month=2027-13')).body.error.code, 'INVALID_MONTH');
  });

  test('user isolation for jobs', async () => {
    assert.ok(!(await B.get('/api/jobs')).body.jobs.some((j) => j.jobId === job.jobId));
    assert.equal((await B.put(`/api/jobs/${job.jobId}`).send({ hourlyWage: 1 })).status, 404);
    assert.equal((await B.delete(`/api/jobs/${job.jobId}`)).status, 404);
    const bCat = (await B.get('/api/categories')).body.categories[0].categoryId;
    assert.equal((await B.post('/api/templates').send({ title: 'x', categoryId: bCat, jobId: job.jobId })).body.error.code, 'JOB_NOT_FOUND');
    assert.equal((await B.get('/api/earnings?month=2027-01')).body.total, 0);
  });
});

describe('template order', () => {
  let A, B;
  before(async () => { A = await signup('ord-a@example.com'); B = await signup('ord-b@example.com'); });

  test('reorders and persists', async () => {
    const ids = (await A.get('/api/templates')).body.templates.map((t) => t.templateId);
    const reversed = [...ids].reverse();
    const r = await A.put('/api/templates/order').send({ templateIds: reversed });
    assert.equal(r.status, 200);
    assert.deepEqual((await A.get('/api/templates')).body.templates.map((t) => t.templateId), reversed);
  });

  test('rejects foreign / duplicate ids', async () => {
    const ids = (await A.get('/api/templates')).body.templates.map((t) => t.templateId);
    assert.equal((await B.put('/api/templates/order').send({ templateIds: ids })).status, 404);
    assert.equal((await A.put('/api/templates/order').send({ templateIds: [ids[0], ids[0]] })).body.error.code, 'VALIDATION_ERROR');
  });
});

describe('local mode (no login)', () => {
  const db = openDb(':memory:');
  const local = createApp(db, { authMode: 'local' });

  test('works without any login and seeds the local user once', async () => {
    const me = await request(local).get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.authMode, 'local');
    const c = await request(local).get('/api/categories');
    assert.equal(c.body.categories.length, 6);
    const t = (await request(local).get('/api/templates')).body.templates[0];
    const e = await request(local).post('/api/events').send({ templateId: t.templateId, date: '2026-10-15' });
    assert.equal(e.status, 201);
    // A second "device" sees the same data.
    assert.equal((await request(local).get('/api/events?start=2026-10-15&end=2026-10-15')).body.events.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  });

  test('login endpoints are disabled', async () => {
    const r = await request(local).post('/api/auth/login').send({ email: 'local@placecal.local', password: 'x' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'AUTH_DISABLED');
  });

  test('adopts the existing account so earlier data stays', async () => {
    const db2 = openDb(':memory:');
    const pw = createApp(db2);
    const a = request.agent(pw);
    await a.post('/api/auth/register').send({ email: 'old@example.com', password: 'password123' });
    const tpl = (await a.get('/api/templates')).body.templates[0];
    await a.post('/api/events').send({ templateId: tpl.templateId, date: '2026-10-20' });
    const me = (await request(createApp(db2, { authMode: 'local' })).get('/api/auth/me')).body.user;
    assert.equal(me.email, 'old@example.com');
  });
});

describe('typed event over a date range', () => {
  let A, catId;
  before(async () => {
    A = await signup('range@example.com');
    catId = (await A.get('/api/categories')).body.categories[0].categoryId;
  });
  test('creates one event per day with the typed values', async () => {
    const r = await A.post('/api/events/bulk').send({
      title: '旅行', categoryId: catId, startTime: '10:00', endTime: '15:00', startDate: '2026-11-10', endDate: '2026-11-12',
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.events.map((e) => [e.date, e.title, e.startTime, e.templateId]), [
      ['2026-11-10', '旅行', '10:00', null], ['2026-11-11', '旅行', '10:00', null], ['2026-11-12', '旅行', '10:00', null],
    ]);
    assert.equal((await A.get('/api/templates')).body.templates.some((t) => t.title === '旅行'), false);
  });
  test('validates the typed values', async () => {
    const r = await A.post('/api/events/bulk').send({ title: '', categoryId: catId, startDate: '2026-11-10', endDate: '2026-11-12' });
    assert.equal(r.body.error.code, 'TITLE_REQUIRED');
    const r2 = await A.post('/api/events/bulk').send({ title: 'x', categoryId: catId, startTime: '12:00', endTime: '10:00', startDate: '2026-11-10', endDate: '2026-11-12' });
    assert.equal(r2.body.error.code, 'INVALID_TIME');
  });
});

describe('pay periods (締め日・支給日)', () => {
  test('payPeriod: 15日締め当月25日払い / 末日締め翌月10日払い / clamps', async () => {
    const { payPeriod } = await import('../src/earnings.js');
    assert.deepEqual(payPeriod({ closingDay: 15, payDay: 25, payMonthOffset: 0 }, '2026-10'),
      { start: '2026-09-16', end: '2026-10-15', payDate: '2026-10-25' });
    assert.deepEqual(payPeriod({ closingDay: 0, payDay: 10, payMonthOffset: 1 }, '2026-10'),
      { start: '2026-10-01', end: '2026-10-31', payDate: '2026-11-10' });
    assert.deepEqual(payPeriod({ closingDay: 20, payDay: 31, payMonthOffset: 1 }, '2026-01'),
      { start: '2025-12-21', end: '2026-01-20', payDate: '2026-02-28' });
  });

  test('earnings use each job\'s own period; transport counted once per day', async () => {
    const A = await signup('period@example.com');
    const catId = (await A.get('/api/categories')).body.categories[0].categoryId;
    const job = (await A.post('/api/jobs').send({ name: '長崎駅前店', hourlyWage: 1100, transportFee: 300, closingDay: 15, payDay: 25, payMonthOffset: 0 })).body.job;
    assert.equal(job.color, '#2f6fde');
    const t = (await A.post('/api/templates').send({ title: 'バイト', categoryId: catId, jobId: job.jobId, startTime: '17:00', endTime: '22:00' })).body.template;
    for (const d of ['2026-09-15', '2026-09-16', '2026-10-15', '2026-10-16']) await A.post('/api/events').send({ templateId: t.templateId, date: d });
    await A.post('/api/events').send({ templateId: t.templateId, date: '2026-10-15' }); // 2 shifts same day
    const j = (await A.get('/api/earnings?month=2026-10')).body.jobs[0];
    assert.equal(j.periodStart, '2026-09-16');
    assert.equal(j.payDate, '2026-10-25');
    assert.deepEqual(j.events.map((e) => e.date), ['2026-09-16', '2026-10-15', '2026-10-15']);
    assert.equal(j.workDays, 2);
    assert.equal(j.transport, 600);
    assert.equal(j.wage, 1100 * 15);
    assert.equal((await A.put(`/api/jobs/${job.jobId}`).send({ closingDay: 29 })).body.error.code, 'VALIDATION_ERROR');
  });
});

describe('break rules (休憩ルール)', () => {
  test('rule applies when the shift has no own break; own break wins', async () => {
    const A = await signup('rules@example.com');
    const catId = (await A.get('/api/categories')).body.categories[0].categoryId;
    const job = (await A.post('/api/jobs').send({
      name: '店', hourlyWage: 1100, breakRules: [{ overMinutes: 480, breakMinutes: 60 }, { overMinutes: 360, breakMinutes: 45 }],
    })).body.job;
    assert.deepEqual(job.breakRules.map((r) => r.overMinutes), [360, 480]); // sorted
    const mk = async (title, s, e, brk) => (await A.post('/api/templates').send({ title, categoryId: catId, jobId: job.jobId, startTime: s, endTime: e, breakMinutes: brk })).body.template;
    const t5 = await mk('5h', '17:00', '22:00', 0);   // ≤6h → no break
    const t8 = await mk('8h', '10:00', '18:00', 0);   // >6h, not >8h → 45
    const t9 = await mk('9h', '09:00', '18:00', 0);   // >8h → 60
    const tOwn = await mk('own', '09:00', '18:00', 30); // explicit 30 wins
    for (const [t, d] of [[t5, '2026-10-01'], [t8, '2026-10-02'], [t9, '2026-10-03'], [tOwn, '2026-10-04']]) {
      await A.post('/api/events').send({ templateId: t.templateId, date: d });
    }
    const j = (await A.get('/api/earnings?month=2026-10')).body.jobs[0];
    assert.deepEqual(j.events.map((e) => [e.breakMinutes, e.minutes]), [[0, 300], [45, 435], [60, 480], [30, 510]]);
    assert.equal(j.breakMinutes, 135);
  });
  test('validation', async () => {
    const A = await signup('rules2@example.com');
    const r = await A.post('/api/jobs').send({ name: 'x', breakRules: [{ overMinutes: 60, breakMinutes: 60 }] });
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    const r2 = await A.post('/api/jobs').send({ name: 'x', breakRules: 'nope' });
    assert.equal(r2.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('widget', () => {
  test('returns next shift, 7 days and salary', async () => {
    const A = await signup('widget@example.com');
    const catId = (await A.get('/api/categories')).body.categories[0].categoryId;
    const job = (await A.post('/api/jobs').send({ name: 'カフェ', hourlyWage: 1000 })).body.job;
    const t = (await A.post('/api/templates').send({ title: 'バイト', categoryId: catId, jobId: job.jobId, startTime: '17:00', endTime: '22:00' })).body.template;
    const pad = (n) => String(n).padStart(2, '0');
    const day = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    await A.post('/api/events').send({ templateId: t.templateId, date: day(2) });
    const r = await A.get('/api/widget');
    assert.equal(r.status, 200);
    assert.equal(r.body.today, day(0));
    assert.equal(r.body.days.length, 7);
    assert.equal(r.body.nextShift.date, day(2));
    assert.equal(r.body.nextShift.jobName, 'カフェ');
    assert.equal(r.body.days[2].events[0].title, 'バイト');
    assert.equal(typeof r.body.salary.total, 'number');
  });
});

describe('scriptable script', () => {
  test('is served with this server address filled in', async () => {
    const r = await request(app).get('/scriptable/PlaceCal.js').set('Host', '192.168.0.5:3001');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("'http://192.168.0.5:3001'"));
    assert.ok(!r.text.includes('__SERVER__'));
  });
});

describe('public server safety', () => {
  test('only the first account can sign up when allowSignup=false', async () => {
    const solo = createApp(openDb(':memory:'), { allowSignup: false });
    assert.equal((await request(solo).get('/api/auth/status')).body.signupOpen, true);
    assert.equal((await request(solo).post('/api/auth/register').send({ email: 'me@example.com', password: 'password123' })).status, 201);
    assert.equal((await request(solo).get('/api/auth/status')).body.signupOpen, false);
    const r = await request(solo).post('/api/auth/register').send({ email: 'other@example.com', password: 'password123' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SIGNUP_CLOSED');
  });

  test('login is throttled after repeated failures', async () => {
    const a = createApp(openDb(':memory:'));
    await request(a).post('/api/auth/register').send({ email: 'x@example.com', password: 'password123' });
    for (let i = 0; i < 10; i++) await request(a).post('/api/auth/login').send({ email: 'x@example.com', password: 'wrong-pass' });
    const r = await request(a).post('/api/auth/login').send({ email: 'x@example.com', password: 'password123' });
    assert.equal(r.status, 429);
  });

  test('widget token: only GET /api/widget, rotatable, embedded in the script', async () => {
    const A = await signup('wt@example.com');
    const token = (await A.get('/api/auth/widget-token')).body.token;
    assert.ok(token.length >= 20);
    assert.equal((await A.get('/api/auth/widget-token')).body.token, token); // stable
    const w = await request(app).get('/api/widget').set('Authorization', `Bearer ${token}`);
    assert.equal(w.status, 200);
    assert.equal((await request(app).get('/api/templates').set('Authorization', `Bearer ${token}`)).status, 401);
    assert.equal((await request(app).get('/api/widget').set('Authorization', 'Bearer wrong-token-wrong-token-xx')).status, 401);
    const s = await request(app).get(`/scriptable/PlaceCal.js?token=${token}`);
    assert.ok(s.text.includes(`const TOKEN = '${token}'`));
    const rotated = (await A.post('/api/auth/widget-token/rotate')).body.token;
    assert.notEqual(rotated, token);
    assert.equal((await request(app).get('/api/widget').set('Authorization', `Bearer ${token}`)).status, 401);
  });
});
