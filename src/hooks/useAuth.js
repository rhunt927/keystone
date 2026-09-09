import { useState, useEffect, useCallback } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
// Full `drive` scope (not just drive.file): drive.file only grants visibility
// into files/folders the app itself created, or that the user explicitly opened
// via a picker — it can never discover a pre-existing file by name search. Our
// keystone.db was authored directly on disk before any login ever happened, so
// under drive.file the app couldn't find it and silently created a duplicate
// empty one instead (see 2026-09-09 incident). Full `drive` removes that
// discovery restriction. Fine to use in Testing status for solo/test-user use;
// would need Google verification review if ever published beyond that.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive profile email'

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
