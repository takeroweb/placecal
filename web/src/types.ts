export type User = { userId: string; name: string; email: string; createdAt: string }

export type Category = {
  categoryId: string; userId: string; name: string; color: string
  createdAt: string; updatedAt: string
}

/** バイト先: shifts from different templates count as the same job. */
export type Job = {
  jobId: string; userId: string; name: string; hourlyWage: number; transportFee: number
  color: string
  /** 0 = 末日締め, 1..28 = その日締め */
  closingDay: number
  /** 1..31 (31 = 末日) */
  payDay: number
  /** 0 = 当月, 1 = 翌月, 2 = 翌々月 */
  payMonthOffset: number
  /** 勤務 overMinutes 超 → breakMinutes の休憩 (used when a shift has no explicit break) */
  breakRules: BreakRule[]
  createdAt: string; updatedAt: string
}
export type BreakRule = { overMinutes: number; breakMinutes: number }
export type JobInput = Pick<Job, 'name' | 'hourlyWage' | 'transportFee'>
  & Partial<Pick<Job, 'color' | 'closingDay' | 'payDay' | 'payMonthOffset' | 'breakRules'>>

export type Template = {
  templateId: string; userId: string; title: string; categoryId: string | null
  jobId: string | null; breakMinutes: number
  startTime: string | null; endTime: string | null; location: string; memo: string
  notificationMinutes: number | null; createdAt: string; updatedAt: string
}

export type CalEvent = {
  eventId: string; userId: string; templateId: string | null; title: string; categoryId: string | null
  jobId: string | null; breakMinutes: number
  date: string; startTime: string | null; endTime: string | null; location: string; memo: string
  notificationMinutes: number | null; source: string; batchId?: string | null; createdAt: string; updatedAt: string
  /** client-only: optimistic placeholder not yet confirmed by the server */
  pending?: boolean
}

export type TemplateInput = Pick<Template,
  'title' | 'categoryId' | 'jobId' | 'breakMinutes' | 'startTime' | 'endTime' | 'location' | 'memo' | 'notificationMinutes'>

export type EventInput = TemplateInput & { date: string }

export type EarningsShift = {
  eventId: string; title: string; date: string; startTime: string | null; endTime: string | null
  breakMinutes: number; minutes: number; wage: number; transport: number; amount: number
}
export type EarningsJob = {
  jobId: string; name: string; color: string; hourlyWage: number; transportFee: number
  closingDay: number; payDay: number; payMonthOffset: number
  periodStart: string; periodEnd: string; payDate: string
  shifts: number; workDays: number; minutes: number; breakMinutes: number
  wage: number; transport: number; total: number; events: EarningsShift[]
}
export type Earnings = {
  month: string; total: number; wage: number; transport: number; minutes: number; shifts: number; jobs: EarningsJob[]
}
