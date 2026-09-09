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

## Decisions Made

- [x] **Search/grounding source: Wikipedia/Wikimedia REST + Action APIs.** Free, no
      key, satisfies the no-spend constraint.
- [x] **No model rewrite step.** Wikipedia's own lead-section prose is used
      **verbatim**, chunked into cards — not summarized/rewritten by a model. Zero
      cost, and nothing to hallucinate since the content *is* the cited source
      word-for-word. Revisit only if a more narrative voice is wanted later (would
      then cost money — the open question from before still applies if so).
- [ ] **Image sourcing** — still open. Wikimedia Commons gives real, licensed,
      attributed photos/art for free, satisfying the no-AI-photorealism guardrail —
      not yet wired into the generation script (text-only proof so far)

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
- [x] **Verified live** on `rhunt927.github.io/keystone` in Safari — same
      sign-in → Domains flow, build ID matched the latest push, confirming the
      `https://rhunt927.github.io` authorized origin works correctly

**Phase 2 complete.** Auth, Drive sync, and SQLite are all working end to end, on
both localhost and the live deploy.

## Phase 3 — Search-Grounding Pipeline (core differentiator — build standalone first)

- [x] **Standalone script built**: `scripts/generate-lesson.mjs` — fetches a
      Wikipedia page (REST summary + Action API lead extract), chunks it into cards
      (verbatim, capped at 6), writes `topics`/`lessons`/`cards`/`sources`/
      `card_sources`/`search_cache` directly to `keystone.db` in Drive via sql.js
      (same lib the app uses). Idempotent re-run (upserts topic/source, replaces the
      lesson's cards). Run via `npm run generate -- "<Wikipedia title>" [domainSlug]`
- [x] **Proof run: "Rosa Parks"** (the exact motivating example from the brief) —
      4 cards written, correctly covering Claudette Colvin's earlier precedent, the
      deliberate legal-test-case strategy, and *Browder v. Gayle* — the real nuance
      Paladin's dramatized version reportedly missed. Verified in the DB directly.
- [x] Every card carries a resolvable source URL (enforced in code — script refuses
      to write if no source URL comes back)
- [x] Results written into `topics`, `lessons`, `cards`, `sources`, `card_sources`,
      `search_cache` — cache means re-running the same topic updates rather than
      re-fetching blindly, and `search_cache` keeps the raw retrieval for audit
- [x] Guardrail: no fabricated quotes/dialogue — moot by construction, since text is
      verbatim Wikipedia prose, never model-rewritten
- [ ] Image sourcing (Wikimedia Commons + attribution) — not yet wired in
- [ ] Decide: is verbatim Wikipedia prose the final voice, or does this need a
      distinct "keystone" editorial voice later (would reintroduce a cost decision)
- [ ] Wire this into the UI as an on-demand action (vs. only a manual script) —
      deferred until Phase 4 has something to trigger it from

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

- [x] **Duplicate "keystone (1)" Drive folder — fixed (2026-09-09)**
      First login created a second, empty `keystone (1)` folder in Drive instead of
      finding the real one. Root cause: `drive.file` OAuth scope only lets an app see
      files/folders it created itself or that the user explicitly opened via a
      picker — it can never discover a pre-existing file by name search. Our
      `keystone.db` was authored directly on disk (via `sqlite3`/the standalone
      script) before any login ever happened, so the app was structurally blind to
      it, searched for a "keystone" folder, found nothing, and created a duplicate.
      Confirmed via direct DB inspection that the real folder's `keystone.db` (with
      the Rosa Parks topic) was untouched — the decoy was schema-only, no data lost.
      Fix: widened `useAuth.js`'s `DRIVE_SCOPE` to full `.../auth/drive` (added via
      Google Cloud Console → Data Access → Manually add scopes — the checkbox-based
      picker didn't reliably persist the selection through Update+Save, pasting the
      scope URL directly into the manual-add box did), and deleted the stray
      duplicate folder. Requires a one-time sign-out/in to re-consent under the new
      scope. Fine to use in Testing status for solo use; would need Google
      verification review if ever published beyond that.
      **Re-tested and confirmed fixed** — signed out/in again on the corrected
      build, only one `keystone` folder exists in Drive now.
- [x] **Build footer showed UTC, read as a confusing wrong time — fixed (2026-09-09)**
      `toISOString()` is always UTC; hardcoded `America/Chicago` via
      `Intl.DateTimeFormat` in `vite.config.js` so the footer always shows local
      time regardless of whether the build ran locally or on a GitHub Actions
      runner (which defaults to UTC). Same underlying behavior exists in
      hunt-garcia-tracker (identical `toISOString()` call), just hadn't been
      noticed there.

---

## Open Questions Still Unresolved

- [ ] Solo-use only, or something intended to be shared/published later? (Affects
      whether other Google accounts ever need access to this Drive file/OAuth client)
- [ ] History-only content at launch, or seed a topic or two in every domain to
      exercise the generic schema right away?
