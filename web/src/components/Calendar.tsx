import { memo } from 'react'
import { WEEKDAYS_SUN, monthGrid, shortRange, ymd } from '../dates'
import type { CalEvent, Category } from '../types'

type Props = {
  year: number
  month: number
  today: string
  eventsByDate: Map<string, CalEvent[]>
  categories: Map<string, Category>
  /** date currently under a dragged template */
  hoverDate: string | null
  /** placement mode: tapping a date places the armed template */
  armed: boolean
  flashDates: Set<string>
  /** event currently being moved (rendered faded) */
  movingId: string | null
  onDateTap: (date: string) => void
  onChipPointerDown: (e: React.PointerEvent, ev: CalEvent) => void
  /** keyboard activation of a chip (pointer taps go through onChipPointerDown) */
  onChipKey: (ev: CalEvent) => void
  /** "+N": show every event of the day */
  onMore: (date: string) => void
}

const MAX_CHIPS = 3

export const Calendar = memo(function Calendar(p: Props) {
  const grid = monthGrid(p.year, p.month)
  return (
    <div className={`cal ${p.armed ? 'is-armed' : ''}`} style={{ ['--weeks' as string]: grid.length }}>
      <div className="cal-head" aria-hidden="true">
        {WEEKDAYS_SUN.map((w, i) => (
          <div key={w} className={`cal-wd ${i === 6 ? 'sat' : ''} ${i === 0 ? 'sun' : ''}`}>{w}</div>
        ))}
      </div>
      <div className="cal-body" role="grid" aria-label={`${p.year}年${p.month + 1}月`}>
        {grid.map((week, wi) => (
          <div className="cal-row" role="row" key={wi}>
            {week.map((d) => {
              const date = ymd(d)
              const evs = p.eventsByDate.get(date) ?? []
              const out = d.getMonth() !== p.month
              const dow = d.getDay() // 0 = Sun
              const cls = [
                'cal-cell',
                out && 'out',
                date === p.today && 'today',
                date === p.hoverDate && 'drop-hover',
                p.flashDates.has(date) && 'flash',
                dow === 6 && 'sat', dow === 0 && 'sun',
              ].filter(Boolean).join(' ')
              return (
                <div
                  role="gridcell"
                  tabIndex={0}
                  key={date}
                  className={cls}
                  data-date={date}
                  aria-label={`${d.getMonth() + 1}月${d.getDate()}日 予定${evs.length}件`}
                  onClick={() => p.onDateTap(date)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.onDateTap(date) }
                  }}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  <span className="cal-chips">
                    {evs.slice(0, MAX_CHIPS).map((e) => {
                      const c = e.categoryId ? p.categories.get(e.categoryId) : undefined
                      return (
                        <button
                          type="button"
                          key={e.eventId}
                          className={`chip ${e.pending ? 'pending' : ''} ${p.movingId === e.eventId ? 'moving' : ''}`}
                          style={{ ['--c' as string]: c?.color ?? '#6b7280' }}
                          title={`${e.title} ${e.startTime ?? ''}${e.endTime ? '〜' + e.endTime : ''}`}
                          onPointerDown={(ev) => p.onChipPointerDown(ev, e)}
                          onClick={(ev) => {
                            // In placement mode a tap anywhere in the cell places the template.
                            if (p.armed) return
                            ev.stopPropagation()
                            if (ev.detail === 0) p.onChipKey(e)
                          }}
                          onContextMenu={(ev) => ev.preventDefault()}
                        >
                          {/* title on top, the time below in small type ('17-22' on phones, '17:00-22:00' when wider) */}
                          <span className="chip-title">{e.title}</span>
                          {e.startTime && <span className="chip-time short">{shortRange(e.startTime, e.endTime)}</span>}
                          {e.startTime && <span className="chip-time full">{e.startTime}{e.endTime ? `-${e.endTime}` : ''}</span>}
                        </button>
                      )
                    })}
                    {evs.length > MAX_CHIPS && (
                      <button type="button" className="chip-more"
                        onClick={(ev) => { if (p.armed) return; ev.stopPropagation(); p.onMore(date) }}>
                        +{evs.length - MAX_CHIPS}
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})
