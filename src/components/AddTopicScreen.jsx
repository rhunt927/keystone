import { useState } from 'react'

// Search-for-a-subject screen: type anything, pick the right Wikipedia
// article from the results, and a lesson gets built from it on the spot.
// Lives in the "Explore" domain, tagged source_kind='generated' — verbatim
// Wikipedia prose read aloud by the device's own voice, not a hand-authored
// lesson, and the UI says so.
export function AddTopicScreen({ onSearch, onPick, onBack }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [building, setBuilding] = useState(null) // title currently being built
  const [error, setError] = useState(null)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim() || searching) return
    setSearching(true)
    setError(null)
    try {
      const hits = await onSearch(query.trim())
      setResults(hits)
    } catch {
      setError("Couldn't search Wikipedia right now — check your connection and try again.")
    } finally {
      setSearching(false)
    }
  }

  async function handlePick(title) {
    setBuilding(title)
    setError(null)
    try {
      await onPick(title)
      // onPick navigates away on success; nothing else to do here.
    } catch (e) {
      setError(e.message || "Couldn't build that lesson — try a different title.")
      setBuilding(null)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm opacity-60 hover:opacity-100">
        ← Domains
      </button>
      <h1 className="text-2xl font-serif">Explore a topic</h1>
      <p className="text-sm opacity-70">
        Search for anything. It's built on the spot from Wikipedia and read aloud by
        your device's voice — not one of the hand-authored lessons, but a real,
        sourced starting point on whatever you're curious about.
      </p>

      {building ? (
        <p className="text-sm opacity-70 animate-pulse">Building a lesson on "{building}"…</p>
      ) : (
        <>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. Hannibal, the Krebs cycle, jazz fusion…"
              className="flex-1 rounded-lg bg-white/50 px-3 py-2 text-sm outline-none focus:bg-white/70"
              autoFocus
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="rounded-lg bg-[#6B4226] text-[#F1E4CF] px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {searching ? '…' : 'Search'}
            </button>
          </form>

          {error && <p className="text-sm text-red-700">{error}</p>}

          {results && (
            results.length === 0 ? (
              <p className="text-sm opacity-70">No matches — try different words.</p>
            ) : (
              <ul className="space-y-2">
                {results.map(r => (
                  <li key={r.title}>
                    <button
                      onClick={() => handlePick(r.title)}
                      className="w-full text-left rounded-lg bg-white/40 hover:bg-white/60 transition-colors px-4 py-3"
                    >
                      <div className="font-medium">{r.title}</div>
                      {r.snippet && <div className="text-xs opacity-70 mt-0.5">{r.snippet}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </div>
  )
}
