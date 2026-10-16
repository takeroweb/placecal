import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { WEEKDAYS, hoursLabel, todayStr, yen } from '../dates'
import type { Earnings, EarningsJob, EarningsShift } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const SHOWN = 5 // shifts shown before "N件すべて表示"

/** '2026-09-16' → '9/16' */
const md = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}` }
/** '2026-09-18' → '9/18 金' */
const mdw = (d: string) => `${md(d)} ${WEEKDAYS[(new Date(d + 'T00:00:00').getDay() + 6) % 7]}`
/** 435 → '7h15m', 300 → '5h' */
const hm = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h${m}m` : `${h}h` }
/** 2835 → '47.25' */
const decHours = (min: number) => String(Math.round((min / 60) * 100) / 100)
const closingLabel = (c: number) => (c ? `${c}日締め` : '末日締め')

/** 給料: 勤務先ごとの締め日〜締め日の期間で、カレンダーに置いた予定から計算する。 */
export function EarningsPage() {
  const [ym, setYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [data, setData] = useState<Earnings | null>(null)
  const [err, setErr] = useState('')
  const month = `${ym.y}-${pad(ym.m + 1)}`
  const today = todayStr()

  const seq = useRef(0)
  const reload = useCallback(() => {
    const s = ++seq.current
    api.earnings(month)
      .then((e) => { if (s === seq.current) { setData(e); setErr('') } })
      .catch((e) => setErr(e instanceof ApiError ? e.message : '読み込めませんでした'))
  }, [month])
  useEffect(reload, [reload])

  const shiftMonth = (d: number) => setYm(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  const active = data?.jobs.filter((j) => j.shifts > 0) ?? []

  return (
    <div className="page salary">
      <header className="sal-head">
        <a className="icon-btn" href="#/" aria-label="カレンダーに戻る">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </a>
        <h1>給料</h1>
        <a className="icon-btn" href="#/earnings/jobs" aria-label="勤務先の設定" title="勤務先の設定">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
        </a>
      </header>

      <div className="sal-month">
        <button className="icon-btn" aria-label="前の月" onClick={() => shiftMonth(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span>{ym.y}年{ym.m + 1}月</span>
        <button className="icon-btn" aria-label="次の月" onClick={() => shiftMonth(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      <div className="sal-body">
        {err && <p className="banner error" role="alert">{err}</p>}

        <section className="sal-hero" aria-live="polite">
          <div className="sal-hero-label">{ym.m + 1}月の給料見込み{active.length > 1 && `（${active.length}か所の合計）`}</div>
          <div className="sal-hero-total">{data ? yen(data.total) : '—'}</div>
          {data && data.shifts > 0 && (
            <>
              <div className="sal-hero-sub">
                {hoursLabel(data.minutes)} · {data.shifts}回勤務{data.transport > 0 && ` · うち交通費 ${yen(data.transport)}`}
              </div>
              {active.length > 1 && data.total > 0 && (
                <>
                  <div className="sal-bar" aria-hidden="true">
                    {active.map((j) => <div key={j.jobId} style={{ flexGrow: j.total || 0.0001, background: j.color }} />)}
                  </div>
                  <div className="sal-legend">
                    {active.map((j) => (
                      <span key={j.jobId}><i style={{ background: j.color }} />{j.name} {yen(j.total)}</span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {data && data.shifts === 0 && (
            <p className="sal-empty">
              この月の勤務はまだありません。<a href="#/earnings/jobs">勤務先</a>を登録し、テンプレートに勤務先を設定してカレンダーに置くと、ここに計算されます。
            </p>
          )}
        </section>

        {active.map((j) => <JobCard key={j.jobId} job={j} today={today} />)}

        <p className="sal-note">
          カレンダーに置いた予定から計算した、税金・社会保険料を引く前の金額です。「予定」は未来の勤務を含んだ見込みです。
        </p>
      </div>

    </div>
  )
}

function JobCard({ job: j, today }: { job: EarningsJob; today: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? j.events : j.events.slice(0, SHOWN)
  return (
    <section className="card sal-card" aria-label={j.name}>
      <div className="sal-card-head">
        <i style={{ background: j.color }} />
        <h2>{j.name}</h2>
        <b className="num">{yen(j.total)}</b>
      </div>
      <p className="sal-period">
        {md(j.periodStart)}〜{md(j.periodEnd)}（{closingLabel(j.closingDay)}）· {md(j.payDate)} 支給
      </p>
      <div className="sal-row">
        <span>勤務時間</span>
        <span className="num">{hoursLabel(j.minutes)}{j.breakMinutes > 0 && <span className="calc">休憩{hoursLabel(j.breakMinutes).replace(/^0時間/, '')}を差引</span>}</span>
      </div>
      <div className="sal-row">
        <span>基本給</span>
        <span className="num"><span className="calc">{yen(j.hourlyWage)} × {decHours(j.minutes)}h</span> {yen(j.wage)}</span>
      </div>
      {j.transportFee > 0 && (
        <div className="sal-row">
          <span>交通費</span>
          <span className="num"><span className="calc">{yen(j.transportFee)} × {j.workDays}日</span> {yen(j.transport)}</span>
        </div>
      )}
      <div className="sal-shifts">
        {shown.map((s) => <ShiftRow key={s.eventId} s={s} future={s.date > today} />)}
      </div>
      {j.events.length > SHOWN && (
        <button type="button" className="sal-more" onClick={() => setAll(!all)}>
          {all ? '閉じる' : `${j.events.length}件すべて表示`}
        </button>
      )}
      {j.events.length <= SHOWN && <div style={{ height: 8 }} />}
    </section>
  )
}

function ShiftRow({ s, future }: { s: EarningsShift; future: boolean }) {
  const parts = [s.startTime ? `${s.startTime}〜${s.endTime}` : '終日']
  if (s.breakMinutes > 0 && s.startTime) parts.push(`休憩${s.breakMinutes}分`)
  parts.push(hm(s.minutes))
  return (
    <div className="sal-shift">
      <span className="d">{mdw(s.date)}</span>
      <span className="tm">{parts.join(' · ')}{future && <span className="tag">予定</span>}</span>
      <span className="p">{yen(s.amount)}</span>
    </div>
  )
}
