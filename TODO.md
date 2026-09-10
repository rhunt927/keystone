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
- [x] ~~No model rewrite step / verbatim only~~ — **REVERSED (2026-09-10).**
      Verbatim Wikipedia prose read aloud was, in the user's words, boring —
      "nothing more than reading back facts on the wiki page." The original brief
      always said the model *should write* the content ("Model summarizes/writes
      short-form content **only** from what was retrieved"); Paladin's sin was
      inventing framing not in any source, not good writing itself. New approach:
      **grounded narrative, authored by Claude from the cited sources** — a hook,
      an arc, an ending — with every beat still carrying a visible citation and
      no invented quotes/events. Authored by hand in working sessions (no
      per-use API cost); the app plays the cached script. `db/lessons/<slug>.json`
      + `scripts/load-lesson.mjs`. The automated verbatim path (`generate-lesson.mjs`)
      stays as the breadth fallback for topics not hand-authored.
- [x] **Image sourcing** — Wikimedia Commons, resolved. Authored lessons name a
      specific `File:` per beat (reliable) or give a search hint; auto-generated
      lessons scan the article's own images by section. No-AI-photorealism
      guardrail satisfied — all real, attributed, licensed art/photos.
- [x] **Motion graphics** — cards can carry a `visual_spec` (JSON) instead of a
      photo. `VisualCard.jsx`: a spread-map (real CC-BY-SA Commons map, radial
      reveal + year ticker) and a count-up counter, both built from the sourced
      figures on the card. Not AI imagery, not dramatization.

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

## Phase 4 — Core UI (in progress)

- [x] Topic picker / home screen — domain click → topic list (title + one-line
      summary), `TopicList.jsx`
- [x] Lesson card viewer — `LessonViewer.jsx`, reworked into a one-card-at-a-time
      story flow (was a plain scroll list): Play/Stop narration, Prev/Next buttons,
      touch-swipe on mobile, progress dots, fade-in per card
- [x] Source attribution shown inline on each card, not buried — a linked
      "Source: {publisher}" line under every card's text
- [x] **Narrated cards, v1** (explicit request — "more like Paladin") — original
      illustrated per-domain avatar + flapping-mouth animation. Feedback: "the
      animation leaves a lot to desire... not show the words, come up with
      something better." Superseded by v2 below.
- [x] **Narrated cards, v2 (current)** — real, attributed photo per topic (fetched
      live from Wikimedia Commons via `generate-lesson.mjs`, stored in the
      `images` table, linked from every card's `image_id`) shown full-bleed with a
      Ken Burns pan/zoom while narrating, plus a minimal audio-equalizer
      indicator — documentary style instead of a cartoon avatar. Body text hidden
      by default (an "Aa" toggle reveals captions on demand). `Narrator.jsx`
      removed. **Still never a rendering of the real person** — it's an actual
      historical photo, exactly what the guardrail prefers.
      Narration itself unchanged: free Web Speech API, can only speak the actual
      sourced card text, never invented dialogue.
- [x] **Apple voice selection + picker** — `useSpeech.js` auto-picks a literally
      Siri-named voice if the OS exposes one (not guaranteed — Apple doesn't
      expose Siri's actual voice model to *any* web app on *any* browser, ever),
      else the best Enhanced/Premium quality Apple voice, else any en-US voice —
      **and** a dropdown lets the user override it with any voice the OS
      reports, persisted to localStorage. Default was landing on macOS's classic
      "Samantha" system voice since nothing better was installed; better voices
      (Ava/Zoe/Nathan Premium, etc.) are a free download under Settings/System
      Settings → Accessibility → Spoken Content.
- [x] **Per-topic content quality pass** — two real bugs found and fixed testing
      against Rosa Parks:
      1. Paragraph selection took only each section's *first* paragraph and
         missed later, more interesting material (a verified real fact — Mike
         Ilitch quietly paying Rosa Parks's rent for a decade — was the 3rd
         paragraph in the "1990s" section, never reached). Now spreads across
         the whole article, guarantees a "later life/legacy/death" section gets
         a slot when one exists, and takes each section's *last* paragraph
         (chronological sections tend to open with a date-and-event sentence
         and save the more human aside for the end).
      2. Image matching now maps each section to the images that literally
         appear inside it (via a raw wikitext scan — `prop=images` does not
         return images in reading order, which had paired an Obama 2012 photo
         with the intro card). Every card gets first claim on its own section's
         image before any card can borrow a neighbor's, fixing an early card
         from greedily stealing a later card's exact-match photo.
      Both required actually verifying the Ilitch claim via live web search
      (CBS News, NBC News, Fox 2 Detroit, NBC Sports) before trusting it and
      writing it in — exactly the app's core discipline, applied to itself.
- [x] Deployed live — Rosa Parks now shows its real 1956 photo with Ken Burns +
      narration: Domains → History → Rosa Parks → 4 sourced, narrated cards
- [x] Voice quality is whatever the OS/browser provides (robotic vs. Paladin's
      produced voiceovers) — acceptable tradeoff for zero cost. User can now pick
      a better installed voice via the dropdown (see above) rather than being
      stuck with the auto-picked one.
- [x] **Narration speed control** — 0.5x–2x slider, persisted. Restarting a whole
      card just to change speed felt bad, so this resumes from the current
      sentence instead (see next item) rather than the top of the card.
- [x] **Sentence-level pause/resume** — narration is chunked into sentences
      (`src/lib/sentences.js`, shared with the image matching below). Pause/Resume
      continues from the current sentence rather than restarting the card.
      Deliberately doesn't use the Web Speech API's native `pause()`/`resume()` —
      that's known to be unreliable in Safari/WebKit, especially on iOS, and this
      app targets Apple devices specifically.
- [x] **Live per-sentence image matching** — a single per-card image couldn't
      reflect multiple distinct things stated within one card (explicit example:
      a card mentioning a statue/bust dedicated at the Capitol needs a photo of
      *that*, not whatever image the card started with). `useSentenceImage.js`
      now live-searches Wikimedia Commons (free, cross-origin via `origin=*`) for
      each sentence as narration reaches it, using proper nouns + a fixed list of
      memorial/object nouns (statue, bust, medal, stamp, etc.) extracted from
      that sentence, combined with the topic name. Falls back to the card's
      stored image while searching or if nothing usable comes back. This is a
      **live runtime dependency**, unlike the rest of the app which only reads
      the Drive-stored `keystone.db` — narrating a card now also calls Commons'
      search API in the browser each time. Still free, no key, but worth noting
      as a new kind of dependency the earlier phases didn't have. Match quality
      depends on Commons' own search relevance and how well-illustrated the
      topic is there — not guaranteed perfect for every sentence on every topic.
- [x] **Grounded-narrative rewrite + motion graphics (2026-09-10)** — see the
      reversed decision up top. First authored lesson: **The Black Death** (9
      beats, `db/lessons/black-death.json`), with an animated spread-map and a
      count-up. `VisualCard.jsx`, `scripts/load-lesson.mjs`, `src/lib/migrate.js`.
      Photos now show full (`object-contain` over a blurred fill) instead of
      being hard-cropped.
- [x] **Auto-play episodes + transport controls (2026-09-10)** — "the manual
      changing of the cards is nuts." A lesson now plays start to finish on its
      own: press play once, each beat narrates and auto-advances, replay at the
      end. Skip-back / play-pause / skip-forward, a scrubbable whole-lesson
      progress bar (tap to jump to a beat), pause-resumes-mid-sentence. Voice &
      speed and transcript moved behind toggles. `useSpeech` reworked with an
      onDone callback and a generation guard against stale Safari onend events;
      `prime()` unlocks iOS speech from the Play tap. Timer-based auto-advance
      fallback when speech synthesis is unavailable.
- [ ] **← NEXT: re-author Rosa Parks as a grounded narrative** — it's still the
      old verbatim version live. Same treatment: `db/lessons/rosa-parks.json`,
      hand-written arc from the cited sources (include the Ilitch rent fact),
      hand-picked images per beat, maybe a timeline visual for the boycott.
- [ ] More authored lessons across domains once the format feels right (needed
      before the "doom-scroll feed" idea is testable — see Open Questions)
- [ ] More `VisualCard` types as lessons need them (timeline, before/after,
      simple bar) — keep each built from sourced numbers only
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
- [~] **Per-sentence live image swap not working right (2026-09-09)** —
      downgraded, not fully fixed. The live per-sentence Commons search
      (`useSentenceImage.js`) is now **only a fallback** for auto-generated
      verbatim lessons that have no curated image. Authored lessons
      (Black Death, and Rosa Parks once redone) ship a hand-picked image or
      motion graphic per beat and never hit this path. Still worth fixing
      eventually for the auto-generated breadth path — old debug checklist:
      is `sentenceIndex` advancing; does the `origin=*` Commons fetch succeed
      from `rhunt927.github.io`; is `extractQuery()` producing sane queries;
      cache keying; the `activeSentence` gating in `LessonViewer`.

---

## Open Questions Still Unresolved

- [ ] Solo-use only, or something intended to be shared/published later? (Affects
      whether other Google accounts ever need access to this Drive file/OAuth client)
- [ ] History-only content at launch, or seed a topic or two in every domain to
      exercise the generic schema right away?
- [ ] **Product framing, stated explicitly (2026-09-09): "something to replace my
      doom scrolling and learn something instead."** Implies a continuous
      auto-advancing feed across topics (open app, content just plays,
      swipe/scroll for more — like a feed, not a click-through menu), not the
      current Domains → Topics → Lesson navigation tree. Deliberately not built
      yet — with only one topic (Rosa Parks) in the DB, a feed would just replay
      the same thing. Needs: (1) more topics generated across domains, (2) a
      decision on whether Domains/Topics browsing stays as a secondary "browse"
      mode alongside a primary feed, or gets replaced entirely.
