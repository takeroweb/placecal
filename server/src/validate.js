import { bad } from './errors.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const NOTIFY_CHOICES = [null, 0, 5, 10, 15, 30, 60, 120, 1440];

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function reqDate(v, field = 'date') {
  if (!isValidDate(v)) throw bad('INVALID_DATE', '日付が正しくありません', field);
  return v;
}

export function title(v, field = 'title', label = 'タイトル') {
  if (typeof v !== 'string' || !v.trim()) throw bad('TITLE_REQUIRED', `${label}を入力してください`, field);
  const t = v.trim();
  if (t.length > 100) throw bad('TITLE_TOO_LONG', `${label}は100文字以内にしてください`, field);
  return t;
}

export function text(v, field, max = 1000) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad('VALIDATION_ERROR', `${field} は文字列で指定してください`, field);
  if (v.length > max) throw bad('VALIDATION_ERROR', `${field} は${max}文字以内にしてください`, field);
  return v.trim();
}

/** Both times null = 時間指定なし. Otherwise both required and start < end. */
export function timeRange(start, end) {
  const s = start === '' || start === undefined ? null : start;
  const e = end === '' || end === undefined ? null : end;
  if (s === null && e === null) return [null, null];
  if (s === null || !TIME_RE.test(s)) throw bad('INVALID_TIME', '開始時刻が正しくありません（HH:MM）', 'startTime');
  if (e === null || !TIME_RE.test(e)) throw bad('INVALID_TIME', '終了時刻が正しくありません（HH:MM）', 'endTime');
  if (s >= e) throw bad('INVALID_TIME', '開始時刻は終了時刻より前にしてください', 'endTime');
  return [s, e];
}

export function notify(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!NOTIFY_CHOICES.includes(n)) throw bad('INVALID_NOTIFICATION', '通知時間が正しくありません', 'notificationMinutes');
  return n;
}

export function color(v) {
  if (typeof v !== 'string' || !COLOR_RE.test(v)) throw bad('INVALID_COLOR', '色は #RRGGBB 形式で指定してください', 'color');
  return v.toLowerCase();
}

const MAX_BULK_DAYS = 366;

/** Dates from start..end (inclusive), optionally filtered by weekday (0=Sun..6=Sat). */
export function dateList(start, end, weekdays) {
  reqDate(start, 'startDate');
  reqDate(end, 'endDate');
  if (start > end) throw bad('INVALID_RANGE', '開始日は終了日以前にしてください', 'endDate');
  let days = null;
  if (weekdays !== undefined && weekdays !== null) {
    if (!Array.isArray(weekdays) || !weekdays.every((w) => Number.isInteger(w) && w >= 0 && w <= 6)) {
      throw bad('VALIDATION_ERROR', '曜日の指定が正しくありません', 'weekdays');
    }
    days = new Set(weekdays);
  }
  const out = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  if ((last - cur) / 86400e3 + 1 > MAX_BULK_DAYS) {
    throw bad('INVALID_RANGE', `一括配置は${MAX_BULK_DAYS}日以内にしてください`, 'endDate');
  }
  for (; cur <= last; cur.setUTCDate(cur.getUTCDate() + 1)) {
    if (!days || days.has(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
  }
  if (!out.length) throw bad('NO_DATES', '条件に合う日がありません', 'weekdays');
  return out;
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** 休憩（分）. Must be shorter than the shift; a shift without times can't have a break. */
export function breakMinutes(v, start, end) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1440) throw bad('INVALID_BREAK', '休憩時間が正しくありません', 'breakMinutes');
  if (n === 0) return 0;
  if (!start || !end) throw bad('INVALID_BREAK', '休憩時間を設定するには開始・終了時刻が必要です', 'breakMinutes');
  if (n >= toMin(end) - toMin(start)) throw bad('INVALID_BREAK', '休憩時間は勤務時間より短くしてください', 'breakMinutes');
  return n;
}

/** Whole yen, 0..1,000,000. */
export function yen(v, field, label) {
  const n = v === '' || v === null || v === undefined ? 0 : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw bad('INVALID_AMOUNT', `${label}は0〜1,000,000の整数で入力してください`, field);
  return n;
}

/** 休憩ルール: up to 5 × { overMinutes 1..1440, breakMinutes 0..600 }, stored sorted by threshold. */
export function breakRules(v) {
  if (!Array.isArray(v) || v.length > 5) throw bad('VALIDATION_ERROR', '休憩ルールが正しくありません', 'breakRules');
  const rules = v.map((r) => ({
    overMinutes: intIn(r?.overMinutes, 1, 1440, 'breakRules', '休憩ルールの勤務時間'),
    breakMinutes: intIn(r?.breakMinutes, 0, 600, 'breakRules', '休憩ルールの休憩時間'),
  }));
  if (rules.some((r) => r.breakMinutes >= r.overMinutes)) throw bad('VALIDATION_ERROR', '休憩は勤務時間より短くしてください', 'breakRules');
  return rules.sort((a, b) => a.overMinutes - b.overMinutes);
}

export function intIn(v, min, max, field, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad('VALIDATION_ERROR', `${label}が正しくありません`, field);
  return n;
}

export function month(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad('INVALID_MONTH', '月の指定が正しくありません（YYYY-MM）', 'month');
  return v;
}
