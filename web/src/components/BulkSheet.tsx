import { useMemo, useState } from 'react'
import { ApiError } from '../api'
import { WEEKDAYS, addDays, timeLabel } from '../dates'
import type { Template } from '../types'

type Props = {
  template: Template
  color: string
  defaultStart: string
  onSubmit: (startDate: string, endDate: string, weekdays?: number[]) => Promise<void>
  onClose: () => void
}

// WEEKDAYS is Mon-first; the API uses JS getDay() numbering (0=Sun..6=Sat).
const jsDay = (monFirstIndex: number) => (monFirstIndex + 1) % 7

/** テンプレート選択 → 開始日・終了日（＋曜日）→ 一括作成 */
export function BulkSheet({ template, color, defaultStart, onSubmit, onClose }: Props) {
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(addDays(defaultStart, 4))
  const [days, setDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const count = useMemo(() => {
    if (!start || !end || start > end) return 0
    let n = 0
    for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
      if (days.has(new Date(d + 'T00:00:00').getDay())) n++
    }
    return n
  }, [start, end, days])

  const toggle = (d: number) => setDays((s) => {
    const n = new Set(s)
    if (n.has(d)) n.delete(d)
    else n.add(d)
    return n
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!start || !end) return setErr('日付を入力してください')
    if (start > end) return setErr('開始日は終了日以前にしてください')
    if (!count) return setErr('条件に合う日がありません')
    setBusy(true)
    setErr('')
    try {
      await onSubmit(start, end, days.size === 7 ? undefined : [...days].sort())
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : '配置できませんでした')
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="複数日に配置">
        <div className="sheet-grip" aria-hidden="true" />
        <h2>複数日に配置</h2>
        <p className="sheet-sub bulk-tpl" style={{ ['--c' as string]: color }}>
          <span className="place-dot" /> <b>{template.title}</b> {timeLabel(template.startTime, template.endTime)}
        </p>

        <div className="field-2">
          <label className="field">
            <span>開始日</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">
            <span>終了日</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>

        <fieldset className="field">
          <legend>曜日</legend>
          <div className="wd-pick">
            {WEEKDAYS.map((w, i) => {
              const d = jsDay(i)
              return (
                <button key={w} type="button" className={`wd ${days.has(d) ? 'on' : ''} ${d === 6 ? 'sat' : ''} ${d === 0 ? 'sun' : ''}`}
                  aria-pressed={days.has(d)} onClick={() => toggle(d)}>{w}</button>
              )
            })}
          </div>
        </fieldset>

        {err && <p className="form-err" role="alert">{err}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={busy || !count}>
            {busy ? '配置中…' : `${count}日に配置`}
          </button>
        </div>
      </form>
    </div>
  )
}
