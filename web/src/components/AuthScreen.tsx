import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import type { User } from '../types'

export function AuthScreen({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [signupOpen, setSignupOpen] = useState(false)
  // First visit to a fresh server → start on 登録. Once the account exists, only ログイン is offered.
  useEffect(() => {
    api.authStatus().then((s) => { setSignupOpen(s.signupOpen); if (s.signupOpen) setMode('register') }).catch(() => {})
  }, [])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password)
      onAuthed(r.user)
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'エラーが発生しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="brand">PlaceCal</h1>
        <p className="auth-lead">入力しないカレンダー。<br />いつもの予定を、置くだけ。</p>
        {mode === 'register' && (
          <label className="field"><span>名前</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        )}
        <label className="field"><span>メールアドレス</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label className="field"><span>パスワード{mode === 'register' && <small>8文字以上</small>}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} /></label>
        {err && <p className="form-err" role="alert">{err}</p>}
        <button className="btn primary wide" disabled={busy}>{mode === 'login' ? 'ログイン' : '登録してはじめる'}</button>
        {signupOpen && (
          <button type="button" className="btn link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr('') }}>
            {mode === 'login' ? 'アカウントを作成' : 'ログインに戻る'}
          </button>
        )}
      </form>
    </main>
  )
}
