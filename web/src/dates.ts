// Date helpers working on local calendar dates as 'YYYY-MM-DD' strings.
const pad = (n: number) => String(n).padStart(2, '0')

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayStr = () => ymd(new Date())

/** Weeks (Mon-start) covering the given month. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // Mon = 0
  const start = new Date(year, month, 1 - offset)
  const last = new Date(year, month + 1, 0)
  const totalDays = offset + last.getDate()
  const weeks = Math.ceil(totalDays / 7)
  const grid: Date[][] = []
  for (let w = 0; w < weeks; w++) {
    const row: Date[] = []
    for (let i = 0; i < 7; i++) row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i))
    grid.push(row)
  }
  return grid
}

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']

export function timeLabel(s: string | null, e: string | null) {
  return s && e ? `${s}〜${e}` : '終日'
}

export function jpDate(date: string) {
  const [, m, d] = date.split('-').map(Number)
  const wd = WEEKDAYS[(new Date(date + 'T00:00:00').getDay() + 6) % 7]
  return `${m}/${d}(${wd})`
}

export const NOTIFY_OPTIONS = [
  { v: '', label: '通知なし' }, { v: '10', label: '10分前' }, { v: '30', label: '30分前' },
  { v: '60', label: '1時間前' }, { v: '1440', label: '前日' },
]

export function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** 510 → "8時間30分" */
export function hoursLabel(min: number) {
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}時間${m}分` : `${h}時間`
}
