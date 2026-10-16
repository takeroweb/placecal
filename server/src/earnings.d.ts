// Types for earnings.js (also used by the browser-only build).
type JobLike = {
  jobId: string; name: string; color: string; hourlyWage: number; transportFee: number
  closingDay: number; payDay: number; payMonthOffset: number
  breakRules?: { overMinutes: number; breakMinutes: number }[]
}
type EventLike = {
  eventId: string; jobId: string | null; title: string; date: string
  startTime: string | null; endTime: string | null; breakMinutes: number
}
export function payPeriod(job: Pick<JobLike, 'closingDay' | 'payDay' | 'payMonthOffset'>, month: string): { start: string; end: string; payDate: string }
export function effectiveBreak(e: EventLike, rules?: JobLike['breakRules']): number
export function paidMinutes(e: EventLike, rules?: JobLike['breakRules']): number
export function summarizeEarnings(jobs: JobLike[], events: EventLike[], month?: string): Omit<import('../../web/src/types').Earnings, 'month'>
