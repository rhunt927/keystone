# Keystone — Feature Backlog

Bite-sized, source-grounded topic learning app. Runs on iPhone, iPad, and desktop
as an installable PWA — no App Store, same pattern as hunt-garcia-tracker.

---

## Done ✓

- [x] **Project brief written** (`accurate-learning-app-brief.md`) — problem statement,
      core design principle (never generate facts from model memory, always ground in
      live retrieval + visible citation), guardrails, format ideas, open questions
- [x] **Branding** — key/keyhole icon + "keystone" serif wordmark (`images/icons/`)
- [x] **GitHub repo created** — [rhunt927/keystone](https://github.com/rhunt927/keystone), public
- [x] **Decision: generic schema, not history-only** — `domains` table so any subject
      (history, science, current events, arts & culture, ...) fits without a rework
- [x] **Decision: storage = Google Drive via OAuth + Drive API**, same live pattern as
      hunt-garcia-tracker (not just a local Drive Desktop file), so it works from any
      device/browser, not just this Mac
- [x] **SQLite schema built** (`db/schema.sql`) — domains, topics, paths, lessons,
      cards, images (with a CHECK guardrail blocking any image flagged as depicting a
      named real person unless it's also flagged as a real photo, never an AI render),
      sources, card_sources, quiz_questions/options, search_cache, progress, schema_meta
- [x] **`keystone.db` created** and placed in Google Drive
      (`My Drive/keystone/keystone.db`) — seeded with the 4 starter domains

---

## Decisions Needed (blocking Phase 3)

- [ ] **Search/grounding source** — brief's core mechanic needs a live retrieval step.
      Options, weighed against the "spend no money" constraint:
      - Wikipedia/Wikimedia REST API — **free**, no key, good encyclopedic coverage,
        pairs naturally with Wikimedia Commons for real attributed images
      - Claude API with web search tool — broader coverage, best synthesis quality,
        but **costs money per call** (token + search fees) — conflicts with no-spend
        unless tightly capped/rate-limited
      - Mix: Wikipedia/Wikimedia as the default free path, something paid as an
        optional later upgrade
      - **Recommendation to discuss:** start Wikipedia/Wikimedia-only (free, and
        Wikipedia citations are themselves inspectable sources) and prove the
        "topic in → sourced summary out" pipeline before considering anything paid
- [ ] **Image sourcing** — if going Wikipedia-first, Wikimedia Commons gives real,
      licensed, attributed photos/art for free, satisfying the no-AI-photorealism
      guardrail out of the box

---

## Phase 1 — App Scaffold ✅

- [x] Scaffold Vite + React + Tailwind CSS v4 project in this repo (mirrors
      hunt-garcia-tracker's setup: `@vitejs/plugin-react`, `@tailwindcss/vite`,
      `vite-plugin-pwa`, ESLint config)
- [x] `vite.config.js` — `base: '/keystone/'`, build-ID footer (git SHA + timestamp)
- [x] PWA manifest — name "Keystone", brand theme color `#6B4226`, `display: 'standalone'`
- [x] Full icon set generated from `images/icons/keystone-icon.svg` via
      `@vite-pwa/assets-generator` (64×64, 192×192, 512×512, maskable 512×512,
      apple-touch-icon, favicon)
- [x] GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) + GitHub Pages
      (Actions source) enabled — confirmed **live** at
      [rhunt927.github.io/keystone](https://rhunt927.github.io/keystone)
- [x] `npm run build` and `npm run lint` both verified clean

## Phase 2 — Auth + Drive + DB Wiring ✅

- [x] Google Cloud project **"Keystone"** created (`keystone-508114`) — separate from
      the old "Claude Finance" project used by hunt-garcia-tracker
- [x] Google Drive API enabled
- [x] OAuth consent screen configured — External, app name "Keystone", support/dev
      contact `rghunt@gmail.com`, scope `.../auth/drive.file` added, test user
      `rghunt@gmail.com` added, status: Testing
- [x] OAuth Client ID created ("Keystone Web") — authorized origins `localhost:5173`
      + `https://rhunt927.github.io` — Client ID stored in local `.env`
      (gitignored) and as the `VITE_GOOGLE_CLIENT_ID` GitHub Actions secret
- [x] `useAuth` — Google Identity Services login/logout, session persistence
      (localStorage token+profile, `ks_` key prefix) — mirrors hunt-garcia-tracker,
      scoped to `drive.file` only (least-privilege, no verification review needed)
- [x] `useGoogleDrive` — download/upload `keystone.db` from the `keystone` Drive folder
- [x] `useDatabase` — sql.js wrapper; applies `db/schema.sql` directly (via `?raw`
      import) so the schema file is the single source of truth for both this and the
      standalone DB build
- [x] `LoginScreen` + `App.jsx` wired end to end; build footer (git SHA + date) now
      shown on every screen — loading, login, and main — per explicit request, so it's
      always possible to confirm which build is running
- [x] `npm run build` verified clean with the real Client ID baked in
- [x] **Local smoke test passed** — signed in as Richard Hunt, consent screen showed
      the correct minimal `drive.file` scope, and the Domains list (History, Science,
      Current Events, Arts & Culture) rendered — confirms the full round-trip: OAuth
      login → Drive download of the real `keystone.db` → sql.js read → render. Not a
      fresh empty DB — the actual file already seeded in Drive.
- [x] Branding refresh — key now doubles as a lowercase "k" with diamond keyhole,
      sepia glow; app's PWA icon set regenerated to match (was showing stale icons
      after the SVG update, since the app only reads from `public/icons/`, not
      `images/icons/` directly)
- [ ] **← NEXT: push to `main` and verify the same login/Domains flow on the live**
      `rhunt927.github.io/keystone` deploy (confirms the `https://rhunt927.github.io`
      authorized origin works, not just `localhost:5173`)
- [ ] Confirm read/write round-trips correctly to the same `keystone.db` this Mac
      already seeded (so Drive Desktop's local copy and the app's live copy agree)

## Phase 3 — Search-Grounding Pipeline (core differentiator — build standalone first)

- [ ] Prove out "topic in → sourced summary out" as a standalone script/page *before*
      wiring it into the UI (per brief's Next Steps)
- [ ] Topic → live retrieval call (source TBD above) → model writes short-form content
      **only** from retrieved material, never unaided memory
- [ ] Every generated fact/card carries a resolvable source URL
- [ ] Write results into `topics`, `lessons`, `cards`, `sources`, `card_sources`,
      `search_cache` (cache so a topic isn't re-searched/re-generated on every view)
- [ ] Enforce guardrails in the generation step: no fabricated quotes/dialogue unless
      sourced, no photorealistic AI imagery of named real people

## Phase 4 — Core UI

- [ ] Topic picker / home screen (browse by domain)
- [ ] Lesson card viewer — short-form swipeable cards, a few minutes per lesson
- [ ] Source attribution shown inline on each card (not buried in fine print)
- [ ] "Deep dive" expansion per topic
- [ ] Quiz component (uses quiz_questions/quiz_options)
- [ ] Path view — themed sequences of topics

## Phase 5 — Cross-Device Polish

- [ ] Verify installable PWA behavior on iPhone Safari, iPad Safari, and desktop
      Chrome/Safari (Add to Home Screen on iOS/iPadOS, install prompt on desktop)
- [ ] Responsive layout pass — card viewer needs to work well at phone width and
      desktop width, not just scaled
- [ ] Offline behavior for already-cached/downloaded content

## Phase 6 — Deploy

- [ ] `.github/workflows/deploy.yml` — GitHub Actions → GitHub Pages, same as
      hunt-garcia-tracker (`npm ci` → `npm run build` with secrets injected →
      `actions/deploy-pages`)
- [ ] Add repo secrets: `VITE_GOOGLE_CLIENT_ID` (+ any search API key, if the
      grounding decision above ends up needing one)
- [ ] Confirm live at `rhunt927.github.io/keystone`

---

## Known Issues

_(none yet)_

---

## Open Questions Still Unresolved

- [ ] Solo-use only, or something intended to be shared/published later? (Affects
      whether other Google accounts ever need access to this Drive file/OAuth client)
- [ ] History-only content at launch, or seed a topic or two in every domain to
      exercise the generic schema right away?
