import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { timeLabel, yen } from '../dates'
import type { BreakRule, Job, JobInput, Template } from '../types'

const CLOSING_PILLS = [10, 15, 20, 25, 0] // 0 = 末日
const JOB_COLORS = ['#2f6fde', '#0e8f8f', '#e8780c', '#8a4fd8', '#d6336c', '#1f9d55', '#c99a06', '#6b7280']
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const closingLabel = (c: number) => (c ? `${c}日締め` : '末日締め')

type Draft = {
  name: string; wage: string; fee: string
  rules: { over: string; brk: string }[]
  closingDay: number; payMonthOffset: number; payDay: string
}

const draftOf = (j?: Job): Draft => ({
  name: j?.name ?? '',
  wage: j ? String(j.hourlyWage) : '',
  fee: j ? String(j.transportFee) : '',
  rules: (j?.breakRules ?? []).map((r) => ({ over: String(r.overMinutes / 60), brk: String(r.breakMinutes) })),
  closingDay: j?.closingDay ?? 0,
  payMonthOffset: j?.payMonthOffset ?? 1,
  payDay: String(j?.payDay ?? 25),
})

const num = (s: string) => Number(s.replace(/[,，\s]/g, '') || 0)
const rulesOf = (d: Draft): BreakRule[] =>
  d.rules.filter((r) => r.over !== '' && r.brk !== '')
    .map((r) => ({ overMinutes: Math.round(Number(r.over) * 60), breakMinutes: Number(r.brk) }))

/** Same rule as the server: the shift's own break, else the highest threshold exceeded. */
function perShift(t: Template, wage: number, fee: number, rules: BreakRule[]) {
  if (!t.startTime || !t.endTime) return fee
  const span = toMin(t.endTime) - toMin(t.startTime)
  let brk = t.breakMinutes
  if (!brk) for (const r of [...rules].sort((a, b) => a.overMinutes - b.overMinutes)) if (span > r.overMinutes) brk = r.breakMinutes
  return Math.floor((wage * Math.max(0, span - brk)) / 60) + fee
}

/** e.g. 15日締め・当月25日 → '9/16〜10/15 の勤務 → 10/25 支給' (shown for this month) */
function example(d: Draft) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  const last = (yy: number, mm: number) => new Date(yy, mm, 0).getDate()
  const c = d.closingDay
  const start = c ? (() => { const p = new Date(y, m - 2, c + 1); return `${p.getMonth() + 1}/${p.getDate()}` })() : `${m}/1`
  const end = c ? `${m}/${c}` : `${m}/${last(y, m)}`
  const pay = new Date(y, m - 1 + d.payMonthOffset, 1)
  const pd = Math.min(num(d.payDay) || 1, last(pay.getFullYear(), pay.getMonth() + 1))
  return `${start}〜${end} の勤務 → ${pay.getMonth() + 1}/${pd} 支給`
}

/** 勤務先の設定 (#/earnings/jobs) */
export function JobSettingsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(draftOf())
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const select = (id: string | 'new', list = jobs) => {
    setSelected(id)
    setDraft(draftOf(id === 'new' ? undefined : list.find((j) => j.jobId === id)))
    setErr('')
    setConfirmDel(false)
  }

  useEffect(() => {
    Promise.all([api.jobs(), api.templates()])
      .then(([j, t]) => {
        setJobs(j.jobs)
        setTemplates(t.templates)
        const first = j.jobs[0]?.jobId ?? 'new'
        setSelected(first)
        setDraft(draftOf(j.jobs[0]))
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : '読み込めませんでした'))
  }, [])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setRule = (i: number, k: 'over' | 'brk', v: string) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))

  const save = async () => {
    if (!draft.name.trim()) return setErr('勤務先の名前を入力してください')
    const input: JobInput = {
      name: draft.name.trim(), hourlyWage: num(draft.wage), transportFee: num(draft.fee),
      breakRules: rulesOf(draft), closingDay: draft.closingDay, payMonthOffset: draft.payMonthOffset,
      payDay: num(draft.payDay) || 25,
    }
    setBusy(true)
    setErr('')
    try {
      if (selected === 'new') {
        const { job } = await api.createJob({ ...input, color: JOB_COLORS[jobs.length % JOB_COLORS.length] })
        const list = [...jobs, job]
        setJobs(list)
        select(job.jobId, list)
      } else if (selected) {
        const { job } = await api.updateJob(selected, input)
        setJobs((p) => p.map((j) => (j.jobId === job.jobId ? job : j)))
        setDraft(draftOf(job))
      }
      setSaved('保存しました')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSaved(''), 2000)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selected || selected === 'new') return
    if (!confirmDel) { setConfirmDel(true); return }
    try {
      await api.deleteJob(selected)
      const list = jobs.filter((j) => j.jobId !== selected)
      setJobs(list)
      select(list[0]?.jobId ?? 'new', list)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '削除できませんでした')
    }
  }

  const job = jobs.find((j) => j.jobId === selected)
  const color = job?.color ?? JOB_COLORS[jobs.length % JOB_COLORS.length]
  const myTemplates = job ? templates.filter((t) => t.jobId === job.jobId) : []

  return (
    <div className="page workplace">
      <header className="sal-head">
        <a className="icon-btn" href="#/earnings" aria-label="戻る">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </a>
        <h1>勤務先の設定</h1>
        <span style={{ width: 44 }} />
      </header>

      <div className="sal-body">
        <nav className="wp-list" aria-label="勤務先">
          {jobs.map((j) => {
            const on = j.jobId === selected
            return (
              <button key={j.jobId} type="button" className={`wp ${on ? 'on' : ''}`} style={{ ['--c' as string]: j.color }}
                aria-current={on} onClick={() => select(j.jobId)}>
                <i className="wp-dot" />
                <span className="wp-text"><b>{j.name}</b><span>{yen(j.hourlyWage)}/時 · 交通費 {yen(j.transportFee)} · {closingLabel(j.closingDay)}</span></span>
                {on ? <span className="wp-editing">編集中</span>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>}
              </button>
            )
          })}
          {selected === 'new' && jobs.length > 0 && (
            <div className="wp on" style={{ ['--c' as string]: color }}>
              <i className="wp-dot" /><span className="wp-text"><b>新しい勤務先</b></span><span className="wp-editing">編集中</span>
            </div>
          )}
          <button type="button" className="wp-add" onClick={() => select('new')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            勤務先を追加
          </button>
        </nav>

        {selected && (
          <>
            <section className="wp-sec" aria-label="基本">
              <label className="lbl" htmlFor="wp-name">勤務先の名前</label>
              <div className="in"><input id="wp-name" value={draft.name} maxLength={100} placeholder="例：長崎駅前店"
                onChange={(e) => set('name', e.target.value)} /></div>
              <div className="wp-2">
                <div>
                  <label className="lbl" htmlFor="wp-wage">時給</label>
                  <div className="in"><span className="unit">¥</span><input id="wp-wage" inputMode="numeric" value={draft.wage} placeholder="1100"
                    onChange={(e) => set('wage', e.target.value)} /></div>
                </div>
                <div>
                  <label className="lbl" htmlFor="wp-fare">交通費（1日）</label>
                  <div className="in"><span className="unit">¥</span><input id="wp-fare" inputMode="numeric" value={draft.fee} placeholder="0"
                    onChange={(e) => set('fee', e.target.value)} /></div>
                </div>
              </div>
              <p className="hint">交通費は出勤した日ごとに1回加算します。</p>
            </section>

            <section className="wp-sec" aria-label="休憩">
              <h3>休憩</h3>
              <p className="hint">勤務時間に応じて、自動で労働時間から差し引きます（テンプレートで休憩を指定した場合はそちらを優先）。</p>
              {draft.rules.map((r, i) => (
                <div className="br" key={i}>
                  <span>勤務</span>
                  <div className="in sm"><input inputMode="decimal" value={r.over} aria-label="勤務時間のしきい値"
                    onChange={(e) => setRule(i, 'over', e.target.value)} /><span className="unit">時間超</span></div>
                  <span>→</span>
                  <div className="in sm"><input inputMode="numeric" value={r.brk} aria-label="休憩時間"
                    onChange={(e) => setRule(i, 'brk', e.target.value)} /><span className="unit">分</span></div>
                  <button type="button" className="br-del" aria-label="このルールを削除"
                    onClick={() => set('rules', draft.rules.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              {draft.rules.length < 5 && (
                <button type="button" className="link-btn" onClick={() => set('rules', [...draft.rules,
                  draft.rules.length === 0 ? { over: '6', brk: '45' } : draft.rules.length === 1 ? { over: '8', brk: '60' } : { over: '', brk: '' }])}>
                  ＋ ルールを追加
                </button>
              )}
            </section>

            <section className="wp-sec" aria-label="締め日と支給日">
              <h3>締め日</h3>
              <p className="hint">給料ページはこの期間で集計します。</p>
              <div className="pills">
                {[...CLOSING_PILLS, ...(CLOSING_PILLS.includes(draft.closingDay) ? [] : [draft.closingDay])].map((c) => (
                  <button key={c} type="button" className={`pill ${draft.closingDay === c ? 'on' : ''}`} aria-pressed={draft.closingDay === c}
                    onClick={() => set('closingDay', c)}>{c ? `${c}日` : '末日'}</button>
                ))}
              </div>
              <h3 className="mt">支給日</h3>
              <div className="wp-2">
                <div className="in sel">
                  <select aria-label="支給月" value={draft.payMonthOffset} onChange={(e) => set('payMonthOffset', Number(e.target.value))}>
                    <option value={0}>当月</option><option value={1}>翌月</option><option value={2}>翌々月</option>
                  </select>
                </div>
                <div className="in"><input inputMode="numeric" value={draft.payDay} aria-label="支給日"
                  onChange={(e) => set('payDay', e.target.value)} /><span className="unit">日</span></div>
              </div>
              <p className="hint">例：{example(draft)}</p>
            </section>

            {job && (
              <section className="wp-sec" aria-label="このバイトのテンプレート">
                <h3>このバイトのテンプレート</h3>
                <p className="hint">ここにあるテンプレートで置いた予定が、給料に入ります。</p>
                {myTemplates.length === 0 && <p className="hint">まだありません。テンプレートの編集画面で「バイト先」にこの勤務先を選んでください。</p>}
                <div className="wp-tpls">
                  {myTemplates.map((t) => (
                    <div key={t.templateId} className="wp-tpl" style={{ ['--c' as string]: color }}>
                      <i /><b>{t.title}</b><span>{timeLabel(t.startTime, t.endTime)}</span>
                      <span className="amt">{yen(perShift(t, num(draft.wage), num(draft.fee), rulesOf(draft)))}/回</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {err && <p className="form-err" role="alert">{err}</p>}
            <button type="button" className="wp-save" onClick={save} disabled={busy}>
              {busy ? '保存中…' : saved || '保存'}
            </button>
            {job && (
              <button type="button" className="wp-delete" onClick={remove}>
                {confirmDel ? 'もう一度押すと削除（予定・テンプレートは残ります）' : 'この勤務先を削除'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
