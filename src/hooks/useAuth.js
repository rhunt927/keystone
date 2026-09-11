import { useState, useEffect, useCallback } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
// Narrow `drive.file` scope (2026-09-11) — visibility only into files/folders
// the app itself creates, or that the user explicitly hands it via Google's
// file picker. This used to be full `drive` scope (see git history) because
// drive.file couldn't discover the pre-existing keystone.db by name search
// and silently created a duplicate empty one instead (2026-09-09 incident).
// The fix isn't going back to full scope — it's the one-time picker step in
// App.jsx (useDriveFolder) that explicitly grants the existing "keystone"
// folder before anything ever tries to search for it by name.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file profile email'

// localStorage: token and profile both persist until explicit sign-out
function loadSession() {
  try {
    const token = localStorage.getItem('ks_token')
    const user = JSON.parse(localStorage.getItem('ks_user') || 'null')
    if (user?.picture?.startsWith('data:')) user.picture = null
    return { token, user }
  } catch { return { token: null, user: null } }
}

function saveSession(user, token) {
  localStorage.setItem('ks_token', token)
  localStorage.setItem('ks_user', JSON.stringify(user))
}

function clearSession() {
  localStorage.removeItem('ks_token')
  localStorage.removeItem('ks_user')
}

async function fetchUserProfile(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return { name: data.name || '', email: data.email || '', picture: data.picture || null }
}

export function useAuth() {
  // Seed state directly from localStorage on first render rather than in an
  // effect — avoids a synchronous setState-in-effect cascade for the common
  // case of an already-signed-in return visit.
  const [user, setUser] = useState(() => loadSession().user)
  const [accessToken, setAccessToken] = useState(() => loadSession().token)
  const [loading, setLoading] = useState(() => !loadSession().token)
  const [gisReady, setGisReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const { token } = loadSession()
    if (token) {
      fetchUserProfile(token).then(userObj => {
        if (cancelled || !localStorage.getItem('ks_token')) return
        saveSession(userObj, token)
        setUser(userObj)
      }).catch(() => {})
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      setGisReady(true)
      if (!token) setLoading(false)
    }
    script.onerror = () => { if (!token) setLoading(false) }
    document.body.appendChild(script)
    return () => { cancelled = true }
  }, [])

  const login = useCallback(() => {
    if (!window.google?.accounts?.oauth2) return
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: async (response) => {
        if (response.error) return
        try {
          const userObj = await fetchUserProfile(response.access_token)
          saveSession(userObj, response.access_token)
          setUser(userObj)
          setAccessToken(response.access_token)
        } catch {
          setUser({ name: '', email: '', picture: null })
          setAccessToken(response.access_token)
        }
      },
    })
    tokenClient.requestAccessToken()
  }, [])

  function logout() {
    clearSession()
    window.location.assign(window.location.origin + import.meta.env.BASE_URL)
  }

  // Called automatically when Drive returns 401/403 — clears stale token
  // WITHOUT revoking it (revoking a stale token can block the next sign-in).
  function clearAuth() {
    clearSession()
    setUser(null)
    setAccessToken(null)
  }

  return { user, accessToken, loading, gisReady, login, logout, clearAuth }
}
