import { jpDate, timeLabel } from '../dates'
import type { CalEvent, Category } from '../types'

type Props = {
  date: string
  events: CalEvent[]
  categories: Map<string, Category>
  onOpen: (e: CalEvent) => void
  onClose: () => void
  onAdd: () => void
  onTimeline: () => void
}

/** All events of one day, plus quick ways to add one or open the timetable. */
export function DaySheet({ date, events, categories, onOpen, onClose, onAdd, onTimeline }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={`${jpDate(date)}の予定`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>{jpDate(date)}</h2>
        <ul className="day-list">
          {events.map((e) => (
            <li key={e.eventId}>
              <button type="button" className="day-item" style={{ ['--c' as string]: categories.get(e.categoryId ?? '')?.color ?? '#6b7280' }}
                onClick={() => onOpen(e)}>
                <span className="day-time">{timeLabel(e.startTime, e.endTime)}</span>
                <b>{e.title}</b>
                {e.location && <span className="day-loc">{e.location}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onTimeline}>タイムテーブル</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>閉じる</button>
          <button type="button" className="btn primary" onClick={onAdd}>＋ 予定を追加</button>
        </div>
      </div>
    </div>
  )
}
