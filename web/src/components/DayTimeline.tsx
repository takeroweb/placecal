import { useEffect, useRef, useState } from 'react'
import { addDays, jpDate, timeLabel } from '../dates'
import { useSwipeNav } from '../useSwipeNav'
import type { CalEvent, Category, Job } from '../types'

const HOUR = 52 // px per hour
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const pad = (n: number) => String(n).padStart(2, '0')

type Block = { e: CalEvent; s: number; en: number; col: number; cols: number }

/** Overlapping events share the width: greedy columns inside each cluster of overlapping events. */
function layout(events: CalEvent[]): Block[] {
  const items: Block[] = events
    .filter((e) => e.startTime && e.endTime)
    .map((e) => ({ e, s: toMin(e.startTime!), en: toMin(e.endTime!), col: 0, cols: 1 }))
    .sort((a, b) => a.s - b.s || b.en - a.en)
  let cluster: Block[] = []
  let colEnds: number[] = []
  let clusterEnd = -1
  const flush = () => { cluster.forEach((b) => (b.cols = colEnds.length)); cluster = []; colEnds = [] }
  for (const b of items) {
    if (b.s >= clusterEnd) { flush(); clusterEnd = -1 }
    let col = colEnds.findIndex((end) => end <= b.s)
    if (col < 0) { col = colEnds.length; colEnds.push(b.en) } else colEnds[col] = b.en
    b.col = col
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, b.en)
  }
  flush()
  return items
}

type Props = {
  date: string
  today: string
  events: CalEvent[]
  categories: Map<string, Category>
  jobs: Map<string, Job>
  onDate: (date: string) => void
  onClose: () => void
  onOpenEvent: (e: CalEvent) => void
  /** add a one-off event, optionally starting at the tapped hour */
  onNew: (date: string, hour?: number) => void
}

/** 1日のタイムテーブル (#/day/YYYY-MM-DD). */
export function DayTimeline({ date, today, events, categories, jobs, onDate, onClose, onOpenEvent, onNew }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  // swipe sideways → previous / next day
  const swipe = useSwipeNav<HTMLDivElement>(() => onDate(addDays(date, -1)), () => onDate(addDays(date, 1)))
  const allDay = events.filter((e) => !e.startTime)
  const blocks = layout(events)
  const color = (e: CalEvent) => categories.get(e.categoryId ?? '')?.color ?? '#6b7280'

  // Current-time line, refreshed every minute (today only).
  const [nowMin, setNowMin] = useState<number | null>(null)
  useEffect(() => {
    if (date !== today) return
    const tick = () => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => { window.clearInterval(id); setNowMin(null) }
  }, [date, today])

  // Open scrolled to the first event (or 8:00).
  const firstStart = blocks[0]?.s
  useEffect(() => {
    const start = firstStart ?? 8 * 60
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (start / 60) * HOUR - HOUR / 2)
  }, [date, firstStart])

  const tapGrid = (e: React.MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    onNew(date, Math.min(23, Math.max(0, Math.floor(y / HOUR))))
  }

  return (
    <div className="daypage" ref={swipe} role="dialog" aria-label={`${jpDate(date)}のタイムテーブル`}>
      <header className="topbar">
        <button className="btn small ghost back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          月
        </button>
        <div className="month-nav">
          <button className="icon-btn" aria-label="前の日" onClick={() => onDate(addDays(date, -1))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className={`month-title day-title ${date === today ? 'is-today' : ''}`}><b>{jpDate(date)}</b></h1>
          <button className="icon-btn" aria-label="次の日" onClick={() => onDate(addDays(date, 1))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="top-actions">
          {date !== today && <button className="btn small" onClick={() => onDate(today)}>今日</button>}
          <button className="btn small primary" onClick={() => onNew(date)}>＋ 予定</button>
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="tl-allday">
          <span className="tl-allday-label">終日</span>
          {allDay.map((e) => (
            <button key={e.eventId} type="button" className="chip tl-allday-chip" style={{ ['--c' as string]: color(e) }}
              onClick={() => onOpenEvent(e)}>
              <span className="chip-title">{e.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tl-scroll" ref={scroller}>
        {events.length === 0 && <p className="tl-empty">予定はありません。時間帯をタップして追加できます。</p>}
        <div className="tl" style={{ height: HOUR * 24 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="tl-hour" style={{ top: h * HOUR, height: HOUR }}>
              <span className="tl-label">{h === 0 ? '' : `${h}:00`}</span>
            </div>
          ))}
          <div className="tl-grid" onClick={tapGrid} aria-label="空いている時間をタップして予定を追加">
            {blocks.map(({ e, s, en, col, cols }) => {
              const job = e.jobId ? jobs.get(e.jobId) : undefined
              const short = en - s < 45
              return (
                <button key={e.eventId} type="button"
                  className={`tl-event ${short ? 'short' : ''} ${e.pending ? 'pending' : ''}`}
                  style={{
                    ['--c' as string]: color(e),
                    top: (s / 60) * HOUR + 1, height: Math.max(22, ((en - s) / 60) * HOUR - 2),
                    left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
                  }}
                  onClick={(ev) => { ev.stopPropagation(); onOpenEvent(e) }}>
                  <b>{e.title}</b>
                  <span>{timeLabel(e.startTime, e.endTime)}</span>
                  {!short && (job || e.location) && <span className="tl-sub">{[job?.name, e.location].filter(Boolean).join('・')}</span>}
                  {!short && e.breakMinutes > 0 && <span className="tl-sub">休憩{e.breakMinutes}分</span>}
                </button>
              )
            })}
            {nowMin !== null && (
              <div className="tl-now" style={{ top: (nowMin / 60) * HOUR }} aria-label={`現在 ${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}`} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
