// Tiny .env reader shared by the authoring scripts — no dependency, just reads
// KEY=value lines. Never logs values; .env stays gitignored.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ENV_PATH = path.join(REPO_ROOT, '.env')

export function readEnv(key) {
  try {
    const line = fs.readFileSync(ENV_PATH, 'utf8')
      .split('\n')
      .find(l => l.startsWith(key + '='))
    return line ? line.slice(key.length + 1).trim() : null
  } catch {
    return null
  }
}

// Sets (or replaces) one KEY=value line in .env, creating the file if needed.
// Used only by drive-auth.mjs to save the refresh token after a one-time
// interactive consent — never called with anything that ends up in git.
export function writeEnv(key, value) {
  let lines = []
  try {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n')
  } catch {
    // no .env yet
  }
  const idx = lines.findIndex(l => l.startsWith(key + '='))
  const line = `${key}=${value}`
  if (idx === -1) lines.push(line)
  else lines[idx] = line
  fs.writeFileSync(ENV_PATH, lines.filter((l, i) => l !== '' || i === lines.length - 1).join('\n'))
}
