// Pure pay calculation, kept separate from HTTP so it can be reused (e.g. future AI shift import preview).
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** (y, m + delta) normalised; m is 1..12 */
const shift = (y, m, delta) => { const t = y * 12 + (m - 1) + delta; return [Math.floor(t / 12), (t % 12) + 1]; };

/**
 * The pay period that closes in `month` ('YYYY-MM'), and its payday.
 *  closingDay 0 = 末日締め (M/1〜M/末), 15 = 15日締め ((M-1)/16〜M/15)
 *  payDay is clamped to the month's last day; payMonthOffset 0 = 当月, 1 = 翌月 …
 */
export function payPeriod(job, month) {
  const [y, m] = month.split('-').map(Number);
  const c = job.closingDay ?? 0;
  let start, end;
  if (!c) {
    start = ymd(y, m, 1);
    end = ymd(y, m, lastDay(y, m));
  } else {
    const [py, pm] = shift(y, m, -1);
    start = c + 1 > lastDay(py, pm) ? ymd(y, m, 1) : ymd(py, pm, c + 1);
    end = ymd(y, m, c);
  }
  const [qy, qm] = shift(y, m, job.payMonthOffset ?? 1);
  const payDate = ymd(qy, qm, Math.min(job.payDay ?? 25, lastDay(qy, qm)));
  return { start, end, payDate };
}

/**
 * Break actually deducted: the shift's own break if set (template/event), otherwise the job's rule
 * for the shift length (e.g. 勤務6時間超→45分, 8時間超→60分 — the highest threshold exceeded wins).
 */
export function effectiveBreak(e, rules = []) {
  if (!e.startTime || !e.endTime) return 0;
  if (e.breakMinutes > 0) return e.breakMinutes;
  const span = toMin(e.endTime) - toMin(e.startTime);
  let b = 0;
  for (const r of rules) if (span > r.overMinutes) b = r.breakMinutes;
  return b;
}

/** Paid minutes of one shift = (end - start) - break. Shifts without times count 0 minutes. */
export function paidMinutes(e, rules = []) {
  if (!e.startTime || !e.endTime) return 0;
  return Math.max(0, toMin(e.endTime) - toMin(e.startTime) - effectiveBreak(e, rules));
}

/**
 * Per job: 基本給 = floor(hourlyWage × total paid hours), 交通費 = transportFee × working days.
 * Each shift also gets its own amount for the list. Jobs with no shifts are still listed.
 */
export function summarizeEarnings(jobs, events, month) {
  const byJob = new Map(jobs.map((j) => {
    const p = month ? payPeriod(j, month) : null;
    return [j.jobId, {
      jobId: j.jobId, name: j.name, color: j.color, hourlyWage: j.hourlyWage, transportFee: j.transportFee,
      closingDay: j.closingDay, payDay: j.payDay, payMonthOffset: j.payMonthOffset, breakRules: j.breakRules ?? [],
      periodStart: p?.start ?? null, periodEnd: p?.end ?? null, payDate: p?.payDate ?? null,
      shifts: 0, workDays: 0, minutes: 0, breakMinutes: 0, wage: 0, transport: 0, total: 0, events: [],
    }];
  }));
  for (const e of events) {
    const j = byJob.get(e.jobId);
    if (!j) continue;
    const brk = effectiveBreak(e, j.breakRules);
    const minutes = paidMinutes(e, j.breakRules);
    const wage = Math.floor((j.hourlyWage * minutes) / 60);
    j.shifts += 1;
    j.minutes += minutes;
    j.breakMinutes += brk;
    j.events.push({
      eventId: e.eventId, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime,
      breakMinutes: brk, minutes, wage, transport: 0, amount: wage,
    });
  }
  for (const j of byJob.values()) {
    // 交通費 is per working day: two shifts on one day get it once (charged to the day's first shift).
    const seen = new Set();
    for (const s of j.events) {
      if (seen.has(s.date)) continue;
      seen.add(s.date);
      s.transport = j.transportFee;
      s.amount += j.transportFee;
    }
    j.workDays = seen.size;
    j.wage = Math.floor((j.hourlyWage * j.minutes) / 60);
    j.transport = j.transportFee * j.workDays;
    j.total = j.wage + j.transport;
  }
  const list = [...byJob.values()];
  const sum = (k) => list.reduce((a, j) => a + j[k], 0);
  return {
    total: sum('total'), wage: sum('wage'), transport: sum('transport'),
    minutes: sum('minutes'), shifts: sum('shifts'), jobs: list,
  };
}
