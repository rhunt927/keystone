// Loads Google's Picker widget on demand (browser-only) and wraps its
// callback API in a promise. This is the one-time "hand the app your
// keystone folder" step that makes the narrow drive.file scope work without
// re-creating the duplicate-folder bug drive.file caused before (see
// useAuth.js) — instead of the app guessing/searching, you tell it exactly
// which folder, once, and Google remembers that grant for this OAuth client.

let loadPromise = null

function loadPickerApi() {
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.picker) { resolve(); return }
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.onload = () => {
      window.gapi.load('picker', { callback: resolve, onerror: reject })
    }
    script.onerror = () => reject(new Error('Failed to load Google Picker'))
    document.body.appendChild(script)
  })
  return loadPromise
}

// Resolves to {id, name} of the folder the user picked, or null if they
// cancelled. Throws only if the picker itself fails to load.
export async function pickFolder(accessToken) {
  await loadPickerApi()
  const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
  return new Promise(resolve => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setTitle('Select your keystone folder')
      .setCallback(data => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0]
          resolve({ id: doc.id, name: doc.name })
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null)
        }
      })
      .build()
    picker.setVisible(true)
  })
}
