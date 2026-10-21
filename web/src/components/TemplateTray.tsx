import { timeLabel } from '../dates'
import type { Category, Folder, Job, Template } from '../types'
import { ROOT_FOLDER } from '../useTemplateGesture'

type Props = {
  /** templates directly in the current folder */
  templates: Template[]
  /** every template (for folder counts / color dots) */
  allTemplates: Template[]
  folders: Folder[]
  /** open folder (null = top level of the List) */
  current: string | null
  categories: Map<string, Category>
  jobs: Map<string, Job>
  armedId: string | null
  /** template being dragged / card it would be dropped onto (reorder) / folder it would move into */
  draggingId: string | null
  reorderOverId: string | null
  overFolder: string | null
  onPointerDown: (e: React.PointerEvent, t: Template) => void
  onKeyboardSelect: (t: Template) => void
  onOpenFolder: (id: string | null) => void
  onAddFolder: () => void
  onEditFolder: (f: Folder) => void
  onAdd: () => void
}

/** "List": folders (nestable) and templates, like a file browser. */
export function TemplateTray(p: Props) {
  const byId = new Map(p.folders.map((f) => [f.folderId, f]))
  const path: Folder[] = []
  for (let f = p.current ? byId.get(p.current) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f)
  const here = path[path.length - 1]
  const children = p.folders.filter((f) => f.parentId === p.current)
  const dropKey = (id: string | null) => id ?? ROOT_FOLDER

  // All templates inside a folder, including its subfolders.
  const inside = (id: string): Template[] => {
    const ids = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const f of p.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.folderId)) { ids.add(f.folderId); grew = true }
    }
    return p.allTemplates.filter((t) => t.folderId && ids.has(t.folderId))
  }
  const color = (t: Template) => (t.categoryId ? p.categories.get(t.categoryId)?.color : undefined) ?? '#6b7280'
  const crumbCls = (id: string | null) => `crumb ${p.overFolder === dropKey(id) && p.draggingId ? 'drop' : ''}`

  return (
    <section className="tray" aria-label="List">
      <div className="tray-head">
        <nav className="crumbs" aria-label="現在のフォルダ">
          {here && (
            <button type="button" className={`crumb-back ${p.overFolder === dropKey(here.parentId) && p.draggingId ? 'drop' : ''}`}
              data-folder-drop={dropKey(here.parentId)} aria-label="1つ上のフォルダへ" onClick={() => p.onOpenFolder(here.parentId)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          <button type="button" className={crumbCls(null)} data-folder-drop={ROOT_FOLDER}
            aria-current={!here} onClick={() => p.onOpenFolder(null)}>List</button>
          {path.map((f) => (
            <span key={f.folderId} className="crumb-wrap">
              <span className="crumb-sep" aria-hidden="true">/</span>
              <button type="button" className={crumbCls(f.folderId)} data-folder-drop={f.folderId}
                aria-current={f === here} onClick={() => p.onOpenFolder(f.folderId)}>{f.name}</button>
            </span>
          ))}
        </nav>
        <p className="tray-hint">
          {p.armedId && p.templates.some((t) => t.templateId === p.armedId)
            ? '選んだカードを押したまま動かすと並び替え・フォルダへ移動'
            : 'タップで選ぶ→押したまま動かして並び替え／上スワイプで日付へ'}
        </p>
        <div className="tray-actions">
          {here && (
            <button type="button" className="icon-btn sm" aria-label={`フォルダ「${here.name}」を編集`} title="フォルダを編集" onClick={() => p.onEditFolder(here)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
            </button>
          )}
          <button type="button" className="icon-btn sm" aria-label="フォルダを追加" title="フォルダを追加" onClick={p.onAddFolder}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 11v5M9.5 13.5h5" /></svg>
          </button>
        </div>
      </div>
      <div className="tray-grid">
        {children.map((f) => {
          const items = inside(f.folderId)
          const sub = p.folders.filter((x) => x.parentId === f.folderId).length
          const dots = [...new Set(items.map(color))].slice(0, 4)
          return (
            <button type="button" key={f.folderId} className={`tcard folder ${p.overFolder === f.folderId && p.draggingId ? 'drop' : ''}`}
              data-folder-drop={f.folderId} onClick={() => p.onOpenFolder(f.folderId)} aria-label={`フォルダ「${f.name}」を開く`}>
              <span className="folder-tab" aria-hidden="true" />
              <span className="tcard-title">
                <svg className="folder-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
                {f.name}
              </span>
              <span className="tcard-time">
                {sub > 0 && `${sub}フォルダ · `}{items.length}件
              </span>
              {dots.length > 0 && (
                <span className="folder-dots" aria-hidden="true">{dots.map((c) => <i key={c} style={{ background: c }} />)}</span>
              )}
            </button>
          )
        })}
        {p.templates.map((t) => {
          const armed = p.armedId === t.templateId
          const job = t.jobId ? p.jobs.get(t.jobId) : undefined
          const cls = ['tcard', armed && 'armed', p.draggingId === t.templateId && 'lifted', p.reorderOverId === t.templateId && !p.overFolder && 'reorder-over']
          return (
            <button
              type="button"
              key={t.templateId}
              data-template-id={t.templateId}
              className={cls.filter(Boolean).join(' ')}
              style={{ ['--c' as string]: color(t) }}
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
          <span>{here ? `${here.name}に追加` : '新しいテンプレート'}</span>
        </button>
      </div>
    </section>
  )
}
