import { useEffect, useState } from 'react'
import { api } from './api'
import type { User } from './types'
import { AuthScreen } from './components/AuthScreen'
import { Planner } from './Planner'
import { EarningsPage } from './components/EarningsPage'
import { JobSettingsPage } from './components/JobSettingsPage'
import { PcHint } from './components/PcHint'
import { useSheetSwipe } from './useSheetSwipe'

// Tiny hash router: '#/' calendar (+ '#/day/…'), '#/earnings' 給料, '#/earnings/jobs' 勤務先の設定.
const readRoute = () =>
  location.hash.startsWith('#/earnings/jobs') ? 'jobs' : location.hash.startsWith('#/earnings') ? 'earnings' : 'calendar'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [localMode, setLocalMode] = useState(false)
  const [route, setRoute] = useState(readRoute)
  useSheetSwipe() // every popup can be swiped down to close
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    api.me().then((r) => { setLocalMode(r.authMode === 'local'); setUser(r.user) }).catch(() => setUser(null))
  }, [])

  if (user === undefined) return <div className="boot" aria-busy="true" />
  if (!user) return <AuthScreen onAuthed={setUser} />
  const page = route === 'earnings' ? <EarningsPage />
    : route === 'jobs' ? <JobSettingsPage />
    : <Planner user={user} onLogout={localMode ? undefined : async () => { await api.logout().catch(() => {}); setUser(null) }} />
  return <>{page}<PcHint /></>
}
