import { useAuth } from './hooks/useAuth'
import { useDatabase } from './hooks/useDatabase'
import { LoginScreen } from './components/LoginScreen'

function BuildFooter() {
  return (
    <footer className="fixed bottom-2 inset-x-0 text-center text-[10px] text-[#3A2415]/70 z-50 pointer-events-none">
      build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
    </footer>
  )
}

function App() {
  const { user, accessToken, loading: authLoading, gisReady, login, logout, clearAuth } = useAuth()
  const { loading: dbLoading, error: dbError, query } = useDatabase(accessToken, clearAuth)

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F1E4CF] text-[#3A2415]">
        Loading…
        <BuildFooter />
      </div>
    )
  }

  if (!user || !accessToken) {
    return (
      <>
        <LoginScreen onLogin={login} gisReady={gisReady} />
        <BuildFooter />
      </>
    )
  }

  const domains = query('SELECT id, slug, name FROM domains ORDER BY id')

  return (
    <div className="min-h-screen bg-[#F1E4CF] text-[#3A2415] px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-serif">keystone</h1>
          <button onClick={logout} className="text-xs opacity-60 hover:opacity-100">
            Sign out
          </button>
        </header>

        {user.name && <p className="text-sm opacity-70">Signed in as {user.name}</p>}

        {dbLoading && <p className="text-sm opacity-70">Loading your lessons from Drive…</p>}
        {dbError && <p className="text-sm text-red-700">{dbError}</p>}

        {!dbLoading && !dbError && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60 mb-2">
              Domains
            </h2>
            <ul className="space-y-1">
              {domains.map(d => (
                <li key={d.id} className="rounded-lg bg-white/40 px-3 py-2 text-sm">
                  {d.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <BuildFooter />
    </div>
  )
}

export default App
