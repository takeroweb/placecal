import { timeLabel } from '../dates'
import type { Category, Job, Template } from '../types'

type Props = {
  templates: Template[]
  categories: Map<string, Category>
  jobs: Map<string, Job>
  armedId: string | null
  /** template being dragged / card it would be dropped onto (reorder) */
  draggingId: string | null
  reorderOverId: string | null
  onPointerDown: (e: React.PointerEvent, t: Template) => void
  onKeyboardSelect: (t: Template) => void
  onAdd: () => void
}

export function TemplateTray(p: Props) {
  return (
    <section className="tray" aria-label="予定テンプレート">
      <div className="tray-head">
        <h2>テンプレート</h2>
        <p className="tray-hint">
          <span className="only-touch">上にスワイプ / タップして日付を選択</span>
          <span className="only-mouse">日付へドラッグ / カード同士で並び替え / クリックで日付を選択</span>
        </p>
      </div>
      <div className="tray-grid">
        {p.templates.map((t) => {
          const c = t.categoryId ? p.categories.get(t.categoryId) : undefined
          const armed = p.armedId === t.templateId
          const job = t.jobId ? p.jobs.get(t.jobId) : undefined
          const cls = ['tcard', armed && 'armed', p.draggingId === t.templateId && 'lifted', p.reorderOverId === t.templateId && 'reorder-over']
          return (
            <button
              type="button"
              key={t.templateId}
              data-template-id={t.templateId}
              className={cls.filter(Boolean).join(' ')}
              style={{ ['--c' as string]: c?.color ?? '#6b7280' }}
              aria-pressed={armed}
              aria-label={`${t.title} ${timeLabel(t.startTime, t.endTime)} を配置`}
              onPointerDown={(e) => p.onPointerDown(e, t)}
              // Pointer gestures are handled in onPointerDown; this click path is keyboard only (detail === 0).
              onClick={(e) => { if (e.detail === 0) p.onKeyboardSelect(t) }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="tcard-bar" aria-hidden="true" />
              <span className="tcard-title">{t.title}</span>
              {job && <span className="tcard-job">{job.name}</span>}
              <span className="tcard-time">{timeLabel(t.startTime, t.endTime)}</span>
              {t.location && <span className="tcard-loc">{t.location}</span>}
            </button>
          )
        })}
        <button type="button" className="tcard add" onClick={p.onAdd}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span>新しいテンプレート</span>
        </button>
      </div>
    </section>
  )
}
