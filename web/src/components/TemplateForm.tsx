import { useState } from 'react'
import { ApiError } from '../api'
import { NOTIFY_OPTIONS } from '../dates'
import type { CalEvent, Category, EventInput, Job, JobInput, Template, TemplateInput } from '../types'

type Values = TemplateInput & { date?: string; endDate?: string }

const NEW = '__new'

const dayCount = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3) + 1

type FormProps = {
  heading: string
  sub: string
  categories: Category[]
  jobs: Job[]
  onCreateJob: (j: JobInput) => Promise<Job>
  /** 時給・交通費 belong to the バイト先, so editing them here updates every template of that job */
  onUpdateJob: (id: string, j: Partial<JobInput>) => Promise<Job>
  initial?: Partial<Values>
  /** show the date field (event editing) */
  withDate?: boolean
  /** adding: optional 終了日 — empty means just the one day */
  withRange?: boolean
  onSubmit: (v: Values) => Promise<void>
  onDelete?: () => void
  onClose: () => void
}

/** Shared sheet for creating/editing templates and editing events. */
function ItemForm({ heading, sub, categories, jobs, onCreateJob, onUpdateJob, initial = {}, withDate, withRange, onSubmit, onDelete, onClose }: FormProps) {
  const [title, setTitle] = useState(initial.title ?? '')
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? (initial.title ? '' : categories[0]?.categoryId ?? ''))
  const [date, setDate] = useState(initial.date ?? '')
  const [endDate, setEndDate] = useState('')
  const [allDay, setAllDay] = useState(initial.title !== undefined && !initial.startTime)
  const [startTime, setStart] = useState(initial.startTime ?? '17:00')
  const [endTime, setEnd] = useState(initial.endTime ?? '22:00')
  const [location, setLocation] = useState(initial.location ?? '')
  const [memo, setMemo] = useState(initial.memo ?? '')
  const [jobId, setJobId] = useState(initial.jobId ?? '')
  const [breakMin, setBreakMin] = useState(String(initial.breakMinutes ?? 0))
  const jobOf = (id: string) => jobs.find((j) => j.jobId === id)
  const [wage, setWage] = useState(String(jobOf(jobId)?.hourlyWage ?? ''))
  const [fee, setFee] = useState(String(jobOf(jobId)?.transportFee ?? ''))
  // Switching バイト先 (or creating one) loads that job's current 時給・交通費.
  const [wageFor, setWageFor] = useState(jobId)
  if (wageFor !== jobId) {
    setWageFor(jobId)
    setWage(String(jobOf(jobId)?.hourlyWage ?? ''))
    setFee(String(jobOf(jobId)?.transportFee ?? ''))
  }
  const [newJob, setNewJob] = useState({ name: '', wage: '', fee: '' })
  const [notify, setNotify] = useState(initial.notificationMinutes == null ? '' : String(initial.notificationMinutes))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Keep an unusual stored value (e.g. 15) selectable instead of silently changing it.
  const notifyOptions = NOTIFY_OPTIONS.some((n) => n.v === notify) ? NOTIFY_OPTIONS : [...NOTIFY_OPTIONS, { v: notify, label: `${notify}分前` }]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setErr({ field: 'title', message: 'タイトルを入力してください' })
    if (withDate && !date) return setErr({ field: 'date', message: '日付を入力してください' })
    if (withRange && endDate && endDate < date) return setErr({ field: 'endDate', message: '終了日は開始日以降にしてください' })
    if (!allDay && startTime >= endTime) return setErr({ field: 'endTime', message: '開始時刻は終了時刻より前にしてください' })
    if (jobId === NEW) return setErr({ field: 'jobId', message: 'バイト先を「追加」してから保存してください' })
    const brk = allDay || !jobId ? 0 : Number(breakMin || 0)
    const job = jobOf(jobId)
    setBusy(true)
    setErr(null)
    try {
      if (job) {
        const patch: Partial<JobInput> = {}
        if (Number(wage || 0) !== job.hourlyWage) patch.hourlyWage = Number(wage || 0)
        if (Number(fee || 0) !== job.transportFee) patch.transportFee = Number(fee || 0)
        if (Object.keys(patch).length) await onUpdateJob(job.jobId, patch)
      }
      await onSubmit({
        title: title.trim(), categoryId: categoryId || null,
        jobId: jobId || null, breakMinutes: brk,
        startTime: allDay ? null : startTime, endTime: allDay ? null : endTime,
        location, memo, notificationMinutes: notify === '' ? null : Number(notify),
        ...(withDate ? { date } : {}),
        ...(withRange && endDate && endDate > date ? { endDate } : {}),
      })
    } catch (ex) {
      setErr(ex instanceof ApiError ? { field: ex.field, message: ex.message } : { message: '保存できませんでした' })
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label={heading}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>{heading}</h2>
        <p className="sheet-sub">{sub}</p>

        <label className="field">
          <span>タイトル</span>
          <input autoFocus={!initial.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：バイト" maxLength={100}
            aria-invalid={err?.field === 'title'} />
        </label>

        <fieldset className="field">
          <legend>カテゴリー</legend>
          <div className="cat-pick">
            {categories.map((c) => (
              <label key={c.categoryId} className="cat-opt" style={{ ['--c' as string]: c.color }}>
                <input type="radio" name="cat" value={c.categoryId} checked={categoryId === c.categoryId}
                  onChange={() => setCategoryId(c.categoryId)} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {withDate && !withRange && (
          <label className="field">
            <span>日付</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-invalid={err?.field === 'date'} />
          </label>
        )}
        {withRange && (
          <div className="field">
            <span className="field-label">日付 <small>{endDate && endDate > date ? `${dayCount(date, endDate)}日間・毎日同じ時間で入ります` : '終了日が空欄なら、この日だけ'}</small></span>
            <div className="time-row">
              <label><span className="sr">開始日</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-invalid={err?.field === 'date'} /></label>
              <span aria-hidden="true">〜</span>
              <label className="end-date"><span className="sr">終了日（任意）</span>
                <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} aria-invalid={err?.field === 'endDate'} />
                {endDate && <button type="button" className="clear" aria-label="終了日をクリア" onClick={() => setEndDate('')}>×</button>}
              </label>
            </div>
          </div>
        )}

        <div className="field">
          <label className="check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span>時間を指定しない（終日）</span>
          </label>
          {!allDay && (
            <div className="time-row">
              <label><span className="sr">開始</span><input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} required /></label>
              <span aria-hidden="true">〜</span>
              <label><span className="sr">終了</span><input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} required
                aria-invalid={err?.field === 'endTime'} /></label>
            </div>
          )}
        </div>

        <div className="field-2">
          <label className="field">
            <span>バイト先 <small>時給を集計</small></span>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-invalid={err?.field === 'jobId'}>
              <option value="">なし</option>
              {jobs.map((j) => <option key={j.jobId} value={j.jobId}>{j.name}</option>)}
              <option value={NEW}>＋ 新しいバイト先…</option>
            </select>
          </label>
          {jobId && jobId !== NEW && !allDay && (
            <label className="field">
              <span>休憩 <small>0なら勤務先のルール</small></span>
              <div className="suffix-input">
                <input type="number" inputMode="numeric" min={0} step={5} value={breakMin}
                  onChange={(e) => setBreakMin(e.target.value)} aria-invalid={err?.field === 'breakMinutes'} />
                <span>分</span>
              </div>
            </label>
          )}
        </div>
        {jobId && jobId !== NEW && (
          <div className="job-pay">
            <div className="field-2">
              <label className="suffix-input"><span className="pre">時給</span>
                <input type="number" inputMode="numeric" min={0} value={wage} placeholder="1100"
                  onChange={(e) => setWage(e.target.value)} aria-invalid={err?.field === 'hourlyWage'} /><span>円</span></label>
              <label className="suffix-input"><span className="pre">交通費</span>
                <input type="number" inputMode="numeric" min={0} value={fee} placeholder="0"
                  onChange={(e) => setFee(e.target.value)} aria-invalid={err?.field === 'transportFee'} /><span>円/日</span></label>
            </div>
            <p className="job-pay-note">「{jobOf(jobId)?.name}」の全テンプレートと収入ページに反映されます</p>
          </div>
        )}
        {jobId === NEW && (
          <div className="new-job">
            <input placeholder="店名（例：カフェ長崎駅前）" value={newJob.name} maxLength={100}
              onChange={(e) => setNewJob({ ...newJob, name: e.target.value })} aria-label="バイト先の名前" />
            <div className="new-job-row">
              <label className="suffix-input"><span className="pre">時給</span>
                <input type="number" inputMode="numeric" min={0} value={newJob.wage} placeholder="1100"
                  onChange={(e) => setNewJob({ ...newJob, wage: e.target.value })} /><span>円</span></label>
              <label className="suffix-input"><span className="pre">交通費</span>
                <input type="number" inputMode="numeric" min={0} value={newJob.fee} placeholder="0"
                  onChange={(e) => setNewJob({ ...newJob, fee: e.target.value })} /><span>円/日</span></label>
              <button type="button" className="btn small primary" onClick={async () => {
                if (!newJob.name.trim()) return setErr({ field: 'jobId', message: 'バイト先の名前を入力してください' })
                try {
                  const j = await onCreateJob({ name: newJob.name.trim(), hourlyWage: Number(newJob.wage || 0), transportFee: Number(newJob.fee || 0) })
                  setJobId(j.jobId)
                  setNewJob({ name: '', wage: '', fee: '' })
                  setErr(null)
                } catch (ex) {
                  setErr(ex instanceof ApiError ? { field: 'jobId', message: ex.message } : { message: '追加できませんでした' })
                }
              }}>追加</button>
            </div>
          </div>
        )}

        <label className="field">
          <span>場所 <small>任意</small></span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例：長崎駅前店" maxLength={200} />
        </label>

        <div className="field-2">
          <label className="field">
            <span>通知</span>
            <select value={notify} onChange={(e) => setNotify(e.target.value)}>
              {notifyOptions.map((n) => <option key={n.v} value={n.v}>{n.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>メモ <small>任意</small></span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} />
          </label>
        </div>

        {err && <p className="form-err" role="alert">{err.message}</p>}

        <div className="sheet-actions">
          {onDelete && <button type="button" className="btn danger" onClick={onDelete}>削除</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </div>
  )
}

/** Category is sent only when one is chosen, so an event/template left 未分類 (category deleted) still saves. */
function clean<T extends Values>(v: T): T {
  const { categoryId, ...rest } = v
  return (categoryId ? v : rest) as T
}

type TemplateProps = {
  categories: Category[]
  jobs: Job[]
  onCreateJob: (j: JobInput) => Promise<Job>
  onUpdateJob: (id: string, j: Partial<JobInput>) => Promise<Job>
  template?: Template
  /** preselected category when creating (e.g. from the category sheet) */
  defaultCategoryId?: string
  onSubmit: (t: TemplateInput) => Promise<void>
  onDelete?: () => void
  onClose: () => void
}

/** Creating is the one time the user types title/time; editing never touches already-placed events. */
export function TemplateForm({ categories, jobs, onCreateJob, onUpdateJob, template, defaultCategoryId, onSubmit, onDelete, onClose }: TemplateProps) {
  return (
    <ItemForm
      heading={template ? 'テンプレートを編集' : 'テンプレートを作成'}
      sub={template ? '変更しても、配置済みの予定はそのままです。' : '一度作れば、あとは日付に置くだけ。'}
      categories={categories} jobs={jobs} onCreateJob={onCreateJob} onUpdateJob={onUpdateJob} initial={template ?? (defaultCategoryId ? { categoryId: defaultCategoryId } : undefined)}
      onSubmit={(v) => onSubmit(clean(v))} onDelete={onDelete} onClose={onClose}
    />
  )
}

type EventProps = {
  categories: Category[]
  jobs: Job[]
  onCreateJob: (j: JobInput) => Promise<Job>
  onUpdateJob: (id: string, j: Partial<JobInput>) => Promise<Job>
  event: CalEvent
  onSubmit: (e: EventInput) => Promise<void>
  onDelete: () => void
  onClose: () => void
}

export function EventForm({ categories, jobs, onCreateJob, onUpdateJob, event, onSubmit, onDelete, onClose }: EventProps) {
  return (
    <ItemForm
      heading="予定を編集" sub="この日の予定だけが変わります。テンプレートには影響しません。"
      categories={categories} jobs={jobs} onCreateJob={onCreateJob} onUpdateJob={onUpdateJob} initial={event} withDate
      onSubmit={(v) => onSubmit(clean(v) as EventInput)} onDelete={onDelete} onClose={onClose}
    />
  )
}

type NewEventProps = {
  categories: Category[]
  jobs: Job[]
  onCreateJob: (j: JobInput) => Promise<Job>
  onUpdateJob: (id: string, j: Partial<JobInput>) => Promise<Job>
  date: string
  startTime?: string
  endTime?: string
  /** endDate is set only when the user picked a range (several days) */
  onSubmit: (e: EventInput, endDate?: string) => Promise<void>
  onClose: () => void
}

/** Tap a date → add a one-off event (optionally over several days). It is NOT saved as a template. */
export function NewEventForm({ categories, jobs, onCreateJob, onUpdateJob, date, startTime, endTime, onSubmit, onClose }: NewEventProps) {
  return (
    <ItemForm
      heading="予定を追加" sub="テンプレートには保存されません。"
      categories={categories} jobs={jobs} onCreateJob={onCreateJob} onUpdateJob={onUpdateJob}
      initial={{ date, startTime: startTime ?? '10:00', endTime: endTime ?? '11:00' }} withDate withRange
      onSubmit={(v) => { const { endDate, ...rest } = clean(v); return onSubmit(rest as EventInput, endDate) }} onClose={onClose}
    />
  )
}
