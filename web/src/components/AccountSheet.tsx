import { useEffect, useState } from 'react'
import { api, ApiError, IS_LOCAL } from '../api'
import { exportBackup, importBackup } from '../local/backend'
import type { User } from '../types'

type Props = {
  user: User
  /** absent when the server runs without login */
  onLogout?: () => void
  onClose: () => void
}

/** アカウント: iPhone widget link (server build) or backup (on-device build), and logout. */
export function AccountSheet(props: Props) {
  return IS_LOCAL ? <BackupSheet onClose={props.onClose} /> : <ServerAccountSheet {...props} />
}

function ServerAccountSheet({ user, onLogout, onClose }: Props) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  useEffect(() => {
    api.widgetToken().then((r) => setToken(r.token)).catch((e) => setErr(e instanceof ApiError ? e.message : '読み込めませんでした'))
  }, [])

  const url = token ? `${location.origin}/scriptable/PlaceCal.js?token=${token}` : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { /* select manually */ }
  }
  const rotate = async () => {
    if (!confirmRotate) { setConfirmRotate(true); return }
    try { setToken((await api.rotateWidgetToken()).token); setConfirmRotate(false) } catch (e) { setErr(e instanceof ApiError ? e.message : '作り直せませんでした') }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="アカウント" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>アカウント</h2>
        <p className="sheet-sub">{onLogout ? user.email : 'ログインなしで使用中'}</p>

        <section className="acct-sec">
          <h3>iPhoneウィジェット</h3>
          <p className="hint">iPhoneのSafariで下のURLを開き、全文をコピーしてScriptableに貼り付けます。このURLには予定を読むための合言葉が入っているので、人に教えないでください。</p>
          <div className="acct-url">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="ウィジェット用スクリプトのURL" />
            <button type="button" className="btn small" onClick={copy} disabled={!url}>{copied ? 'コピーしました' : 'コピー'}</button>
          </div>
          <div className="acct-actions">
            <a className="btn small ghost" href={url || undefined} target="_blank" rel="noreferrer">開く</a>
            <button type="button" className={`btn small ${confirmRotate ? 'danger' : 'ghost'}`} onClick={rotate} disabled={!token}>
              {confirmRotate ? '作り直す（今のウィジェットは止まります）' : '合言葉を作り直す'}
            </button>
          </div>
        </section>

        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {onLogout && <button type="button" className="btn ghost" onClick={onLogout}>ログアウト</button>}
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

/**
 * On-device build: everything lives on this iPhone, so offer a backup file
 * (Files / iCloud Drive) to survive deleting the app or changing phones.
 */
function BackupSheet({ onClose }: { onClose: () => void }) {
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState<string | null>(null) // backup text waiting for confirmation

  const save = async () => {
    setErr(''); setMsg('')
    try {
      const text = await exportBackup()
      const d = new Date()
      const name = `placecal-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
      const file = new File([text], name, { type: 'application/json' })
      // iPhone: the share sheet offers "ファイルに保存" (iCloud Drive etc.)
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'PlaceCal バックアップ' })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(file)
        a.download = name
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
      setMsg('バックアップを書き出しました')
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return // share sheet closed
      setErr('書き出せませんでした')
    }
  }

  const pick = async (f: File | undefined) => {
    setErr(''); setMsg('')
    if (!f) return
    setPending(await f.text())
  }
  const restore = async () => {
    if (!pending) return
    try {
      await importBackup(pending)
      location.reload() // reload everything from the restored data
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '読み込めませんでした')
      setPending(null)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="バックアップ" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2>データとバックアップ</h2>
        <p className="sheet-sub">予定やテンプレートは、この端末の中だけに保存されています。</p>

        <section className="acct-sec">
          <h3>バックアップを書き出す</h3>
          <p className="hint">「ファイルに保存」で iCloud Drive などに保存しておくと、アプリを消したときや機種変更のときに戻せます。</p>
          <button type="button" className="btn small primary" onClick={save}>書き出す</button>
        </section>

        <section className="acct-sec" style={{ marginTop: 10 }}>
          <h3>バックアップから戻す</h3>
          <p className="hint">今のデータは、選んだバックアップの内容に<b>置き換わります</b>。</p>
          {!pending && (
            <label className="btn small ghost file-btn">
              ファイルを選ぶ
              <input type="file" accept="application/json,.json" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
          )}
          {pending && (
            <div className="acct-actions">
              <button type="button" className="btn small danger" onClick={restore}>置き換えて戻す</button>
              <button type="button" className="btn small ghost" onClick={() => setPending(null)}>やめる</button>
            </div>
          )}
        </section>

        {msg && <p className="hint" role="status" style={{ marginTop: 10 }}>{msg}</p>}
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
