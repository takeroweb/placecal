import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api'
import { timeLabel } from '../dates'
import type { Category, Job, Template } from '../types'

const PALETTE = ['#2f6fde', '#1f9d55', '#e8780c', '#0e8f8f', '#8a4fd8', '#d6336c', '#c99a06', '#6b7280']

type Props = {
  categories: Category[]
  /** live list: adding / editing / deleting a template is reflected here immediately */
  templates: Template[]
  jobs: Map<string, Job>
  onEditTemplate: (t: Template) => void
  onAddTemplate: (categoryId: string) => void
  onCreate: (c: { name: string; color: string }) => Promise<void>
  onUpdate: (id: string, c: Partial<{ name: string; color: string }>) => Promise<void>
  onDelete: (c: Category) => Promise<void>
  onClose: () => void
}

/** Every change is saved immediately — there is no separate "save" step. */
export function CategorySheet({ categories, templates, jobs, onEditTemplate, onAddTemplate, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [err, setErr] = useState('')
  // Templates whose category was deleted.
  const uncategorized = templates.filter((t) => !t.categoryId || !categories.some((c) => c.categoryId === t.categoryId))

  const run = async (fn: () => Promise<void>) => {
    setErr('')
    try { await fn() } catch (ex) { setErr(ex instanceof ApiError ? ex.message : '保存できませんでした') }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setErr('カテゴリー名を入力してください')
    run(async () => { await onCreate({ name: name.trim(), color }); setName('') })
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="カテゴリー" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>カテゴリー</h2>
        <p className="sheet-sub">色はカレンダーとテンプレートに反映されます。カテゴリーを削除しても予定やテンプレートは消えません。</p>

        <ul className="cat-list">
          {categories.map((c) => (
            <CategoryRow key={c.categoryId} category={c}
              templates={templates.filter((t) => t.categoryId === c.categoryId)} jobs={jobs}
              onEditTemplate={onEditTemplate} onAddTemplate={() => onAddTemplate(c.categoryId)}
              onUpdate={(patch) => run(() => onUpdate(c.categoryId, patch))}
              onDelete={() => run(() => onDelete(c))} />
          ))}
          {uncategorized.length > 0 && (
            <li className="cat-item">
              <div className="cat-row"><span className="color-btn none" aria-hidden="true" /><span className="cat-none">未分類</span></div>
              <TemplateChips templates={uncategorized} jobs={jobs} color="#6b7280" onEdit={onEditTemplate} />
            </li>
          )}
        </ul>

        <form className="cat-add" onSubmit={add}>
          <ColorButton value={color} onChange={setColor} label="新しいカテゴリーの色" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新しいカテゴリー" maxLength={100} aria-label="新しいカテゴリー名" />
          <button className="btn small primary" type="submit">追加</button>
        </form>
        <div className="swatches" aria-label="色の候補">
          {PALETTE.map((p) => (
            <button key={p} type="button" className={`swatch ${p === color ? 'on' : ''}`} style={{ background: p }}
              aria-label={p} aria-pressed={p === color} onClick={() => setColor(p)} />
          ))}
        </div>

        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

function CategoryRow({ category, templates, jobs, onEditTemplate, onAddTemplate, onUpdate, onDelete }: {
  category: Category
  templates: Template[]
  jobs: Map<string, Job>
  onEditTemplate: (t: Template) => void
  onAddTemplate: () => void
  onUpdate: (patch: Partial<{ name: string; color: string }>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(category.name)
  const [confirm, setConfirm] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commitName = () => {
    const n = name.trim()
    if (!n) return setName(category.name)
    if (n !== category.name) onUpdate({ name: n })
  }
  // Two-step delete instead of a confirm dialog.
  const del = () => {
    if (confirm) { window.clearTimeout(timer.current); onDelete(); return }
    setConfirm(true)
    timer.current = window.setTimeout(() => setConfirm(false), 3000)
  }

  return (
    <li className="cat-item">
     <div className="cat-row">
      <ColorButton value={category.color} onChange={(c) => onUpdate({ color: c })} label={`${category.name}の色`} />
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        maxLength={100} aria-label="カテゴリー名" />
      <button type="button" className={`btn small ${confirm ? 'danger' : 'ghost'}`} onClick={del}>
        {confirm ? '本当に削除' : '削除'}
      </button>
     </div>
      <TemplateChips templates={templates} jobs={jobs} color={category.color} onEdit={onEditTemplate} onAdd={onAddTemplate} />
    </li>
  )
}

/** Templates of one category, grouped by バイト先 so different shifts of the same job sit together. */
function TemplateChips({ templates, jobs, color, onEdit, onAdd }: {
  templates: Template[]
  jobs: Map<string, Job>
  color: string
  onEdit: (t: Template) => void
  onAdd?: () => void
}) {
  const groups = new Map<string, Template[]>()
  for (const t of templates) {
    const key = t.jobId && jobs.has(t.jobId) ? t.jobId : ''
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const chip = (t: Template) => (
    <button key={t.templateId} type="button" className="cat-tpl" onClick={() => onEdit(t)}
      aria-label={`テンプレート「${t.title}」を編集`}>
      <b>{t.title}</b><span>{timeLabel(t.startTime, t.endTime)}</span>
    </button>
  )
  return (
    <div className="cat-tpls" style={{ ['--c' as string]: color }}>
      {[...groups].filter(([k]) => k).map(([k, list]) => (
        <div key={k} className="cat-job">
          <span className="cat-job-name">{jobs.get(k)!.name}</span>
          {list.map(chip)}
        </div>
      ))}
      {(groups.get('') ?? []).map(chip)}
      {onAdd && (
        <button type="button" className="cat-tpl add" onClick={onAdd} aria-label="このカテゴリーにテンプレートを追加">＋ テンプレート</button>
      )}
    </div>
  )
}

/** The native picker fires continuously while dragging, so commits are debounced. */
function ColorButton({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  const [local, setLocal] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setLocal(value) } // follow outside changes (swatches, saved value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <label className="color-btn" style={{ background: local }}>
      <input type="color" value={local} aria-label={label} onChange={(e) => {
        const c = e.target.value
        setLocal(c)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => onChange(c), 350)
      }} />
    </label>
  )
}
