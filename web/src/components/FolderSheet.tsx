import { useState } from 'react'
import { ApiError } from '../api'
import type { Folder } from '../types'

type Props = {
  /** editing an existing folder; absent = creating one inside `parentName` */
  folder?: Folder
  parentName: string
  onSubmit: (name: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

/** Create / rename / delete a List folder. Deleting moves its contents up one level. */
export function FolderSheet({ folder, parentName, onSubmit, onDelete, onClose }: Props) {
  const [name, setName] = useState(folder?.name ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setErr('フォルダ名を入力してください')
    setBusy(true)
    try { await onSubmit(name.trim()) } catch (ex) { setErr(ex instanceof ApiError ? ex.message : '保存できませんでした'); setBusy(false) }
  }
  const del = async () => {
    if (!confirm) { setConfirm(true); return }
    try { await onDelete?.() } catch (ex) { setErr(ex instanceof ApiError ? ex.message : '削除できませんでした') }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label={folder ? 'フォルダを編集' : 'フォルダを作成'}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>{folder ? 'フォルダを編集' : 'フォルダを作成'}</h2>
        <p className="sheet-sub">{folder ? `場所：${parentName}` : `「${parentName}」の中に作ります。例：バイト › ホテル、中華`}</p>
        <label className="field">
          <span>フォルダ名</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：ホテル" maxLength={100} />
        </label>
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {folder && onDelete && (
            <button type="button" className={`btn ${confirm ? 'danger' : 'ghost'}`} onClick={del}>
              {confirm ? '削除する（中身は1つ上へ）' : '削除'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn primary" disabled={busy}>{folder ? '保存' : '作成'}</button>
        </div>
      </form>
    </div>
  )
}
