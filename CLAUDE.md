# CLAUDE.md

## What this is

**The EI** is a live-scoring web app for the *Eisenberg Invitational*, an annual
golf weekend for a group of about eight friends. Every player opens it on their
phone, usually added to the home screen, and scores go to every other phone in
real time.

The app covers:

- **Games tab (`home`)**: the rounds and games for the weekend, **all days by
  default** (`homeShowAll = true`). A "Just today" chip narrows it when the
  tournament is actually on; narrowing by default made a four-day weekend read
  as a one-day one and hid everything from anyone looking beforehand (R124).
  Tap a game to open its hole-by-hole scorecard.
- **Game formats** (`LABEL`, `index.html` ~line 738):
  - `BESTBALL`: 2v2 best ball, **match play** with net scores (holes won,
    `3&2`, dormie, and so on).
  - `SCRAMBLE4` / `SCRAMBLE3`: 4v4 and 3v3 scrambles, **stroke play** on
    one team score per hole, with no handicaps.
  - `SCRAMBLE2X4`: 2v2v2v2 scramble. **Four** teams of two, no handicaps. The
    **top two teams win and the bottom two lose**; a tie straddling that line
    is a tie for everyone in it, because second and third can't be honestly
    separated. `g.oneGroup` records whether all eight played as one group — if
    so the round is left out of the "same foursome" pairings column, since
    adding one to all 28 pairs says nothing about how the field is mixed.
    - **Scored on skins when `g.skins` is set**, otherwise on strokes. Two
      skins a hole, to the two best team scores; a tie takes the skins for the
      places it covers and splits them, so `4,5,5,5` is one skin and a third
      each, and all four level is a half each. Counted in **twelfths**
      (`SKIN = 12`) because every split that can arise divides into twelve
      exactly — a weekend of thirds stored as `0.33` would not add up, and
      `teamOutcomes` reads these totals. `holeSkins` returns `null` until
      every side has scored: you can't know the best two while one is still out
      there. `gameResult` must test `isSkins` **before** `isStroke`, since a
      skins game is still a `SCRAMBLE2X4`.
    - The flag is **absent-means-strokes** on purpose. Changing the format
      itself would re-score every stored 2v2v2v2 and move the all-time
      records.
    - `g.tees` is a per-side tee name (`{0:"Black",1:"Blue",…}`) for a
      four-team game, since the teams are levelled by the boxes rather than by
      handicaps and the same man plays a different tee depending on his
      partner. It is **display only** — `teeNameIn` uses it, `courseHcp`
      never does, and these formats take no handicaps anyway.
    - Both ride in the GAME row's **`notes`** column as words — `Skins. Tees:
      Black / Blue / Members / Purple` — rather than more format suffixes, and
      `scheduleToCSV` writes the same sentence back. `own` leaves a side on
      each man's own tee.
  - `FORTYBALL`: "40ball". Each team must count exactly 40 net scores across
    18 holes. Selections are hidden from the other team until they are locked.
- **Handicaps**: course handicap = `index × slope/113 + (rating − par)`,
  calculated per course and tee. A player's tee is stored per course. A round's
  `mode` is either `RELATIVE` (strokes off the lowest player in the game) or
  `FULL`.
- **Sanctioned rounds**: a round carries `counts`. `counts === false` means it's
  on the schedule and scored like any other, but **excluded from `standings()`
  and `pairMatrix()`** — not as a win, not as a loss, not even as a game played,
  since counting a played game with no result would drag win% down. 2026's
  Thursday-morning fivesome at Hammock Bay is the case it exists for.
  - **Absent means sanctioned** (`roundCounts = r => !r || r.counts !== false`),
    so rounds from older builds and every past year read out of Firestore keep
    their records. That's why there was no `SCHEMA` bump.
  - Use `gameCounts(g)`, which resolves the round with `EV(g.roundId)` and
    **not** `roundOf(g)` — the latter falls back to `ROUNDS()[0]`, which would
    make an orphan game inherit whatever flag the first round happens to have.
  - The flag is on the **round**, never the game: a round can hold several games
    and it's the round that is or isn't part of the tournament.
- **Board tab**: the leaderboard for the year (W/L/T, ranked on points) and
  a **History** view. History combines years the app scored with years from
  before the app (`HISTORY_SEED`) and ranks all-time records by win percentage.
  History needs no special casing for the above: `recordsFor` runs `standings()`
  inside `withYearData`, which swaps `SCHEDULE` in, so the round lookup resolves
  against the right year.
- **Schedule tab**: the weekend itinerary: travel, meals, rounds (`type:"ROUND"`)
  and other events. Admins can edit it or bulk-import it as CSV. The CSV `type`
  column takes `ROUND-CASUAL` for an unsanctioned round — a separate type rather
  than a flag in another column, so it reads for itself in the spreadsheet.
  Anything a ROUND row carries has to be written by **both** `parseCSV` and
  `scheduleToCSV` or it's silently lost on a round trip; `notes` was dropped that
  way for months (R109).
- **Field tab**: players, handicap indexes, tees, courses, pairings matrix and
  admin setup.
- **Admin mode**: unlocked with `ADMIN_CODE` (`"eagle"`, in the page source).
  It guards against mis-taps and is **not** a security boundary. With no
  Firebase config, admin is always unlocked.
- **Multi-year**: there is one tournament per year. Past years are
  read-only archives. "Start a new year" copies players and courses forward,
  and the schedule and scores start empty.

## Repository layout

There is no build step, no package.json and no framework. The app is a single
static HTML file.

| File | Purpose |
|---|---|
| `index.html` | **The app.** All HTML, CSS and JS inline (~4,700 lines, one `<script>`). This is what is served. |
| `ei-tests.js` | jsdom test suite: smoke, scoring logic and one regression test per past bug. |
| `apple-touch-icon.png` | Home-screen icon. It has to be a real file because iOS ignores inline icons. |
| `og-image.png` | Link-preview image, referenced by absolute GitHub Pages URL in the `og:`/`twitter:` meta tags. |

(`ei-prototype.html` and `Index.html.html` were stale pre-Firebase copies and
have been deleted.)

All files have been committed as "Add files via upload", so the code has been
edited elsewhere and uploaded through the GitHub web UI.

### Navigating `index.html`

The script is organized top-down, with banner comments (`/* ===== ... ===== */`):

1. Seed data: `COURSES`, `PLAYERS`, `GAMES`, `SCHEDULE`, `DAYS`. These are demo
   defaults, overwritten by Firestore once connected.
2. Scoring engines: handicaps (§1.4–1.5), match play (§3), 40ball (§8), stroke
   play, `gameResult`, `standings` (§11).
3. History: `HISTORY_SEED`, `HIST`, `withYearData`, `allTime`.
4. **Sync layer** (`FIREBASE_CONFIG`, `SYNC`, `initSync`, `connectWith`, …).
5. Durable write queue, migration (`migrateLoaded`), push/delete helpers.
6. View state, version check, `render()` router and the `render*` screens.
7. A single delegated click handler (`handleClick`) and input handlers.
8. Boot at the bottom of the file: `migrateLoaded(); applyQueueLocally(); render(); initSync(); checkForUpdate()`.

Rendering is plain string templating into `#app`, with `esc()` for escaping and
a full re-render on state change. Re-renders triggered by snapshots are skipped
while an `<input>` has focus, so typing isn't interrupted.

## Hosting

- **GitHub Pages** serves the repository root:
  `https://bjeisenberg11.github.io/Ei-app/` (see the `og:image` meta tags).
  Deploying means pushing `index.html` to the Pages branch. There is no CI
  and no workflow.
- The page loads external code only from CDNs: Google Fonts, and the Firebase JS SDK
  **v10.12.0** as ES modules from `gstatic.com`, imported dynamically in
  `initSync()`. If the SDK fails to load, the app falls back to local-only mode
  and doesn't crash.
- **No service worker.** Instead there is a **build-stamp self-update**:
  - `const BUILD = "YYYY-MM-DD.HHMM"` in `index.html`. **Bump it on every
    release.** String comparison of the stamp works as a date comparison.
  - `checkForUpdate()` fetches its own URL with a `?cb=` cache-buster,
    reads the `BUILD` stamp out of the published HTML, and shows an "Update"
    bar if that stamp is newer. `applyUpdate()` reloads with `?v=<build>`
    to get past iOS home-screen caching. It runs on open and every time the
    app returns to the foreground, at most once every 2 minutes.
  - The no-cache `<meta http-equiv>` tags are there for the same reason.

## Firebase / Firestore sync

Firebase project: `ei-app-81bf4`. The config is hard-coded in
`FIREBASE_CONFIG`. If `apiKey` is blank, the app runs entirely in memory on one
device (`SYNC.state = "local"`), which is useful for testing scoring.

**Access model:** there is no Firebase Auth. The database uses **open Firestore
rules**, so anyone with the link can read and write. This is deliberate for a
private group with no personal data. Don't present the admin code as security.

### Data shape

```
tournaments/_index                 { years: ["2025","2026"], live: "2026" }   year registry
tournaments/_history               { years: { "2021": { rows:[{name,w,l,t,gp}] }, ... } }  pre-app records
tournaments/ei-{YEAR}              config: { schema, appBuild, players, courses, schedule, days }
tournaments/ei-{YEAR}/games/{id}   one doc per game: { id, roundId, type, teams:{0:[..],1:[..]}, hidden?, oneGroup?, holes:{ "0":{...}, ..., "17":{...} } }
```

Each hole is `{ scores:{pid: n|"PU"}, teamScore:{0..3}, conceded, selected:{0:[],1:[]}, locked:{0..3} }`.

**Sides are not always two.** `SIDES[g.type]` gives the count, and
`sides(g)` / `sideCount(g)` / `isMulti(g)` are the only correct way to iterate
them — `teams` runs 0..3 for a `SCRAMBLE2X4`. Most bugs in this app's history
are some helper hardcoding `[0,1]` or `locked[0] && locked[1]`; before writing
either, check whether a four-team game can reach that line.

**Shape rules that are easy to break and are covered by tests:**

- `holes` and `teams` are **maps keyed by index**, not arrays. Firestore rejects
  arrays of arrays, and field-path writes like `holes.7.scores.p3` silently
  fail against arrays.
- Don't write `undefined` or nested arrays anywhere (see the `FIRESTORE` section of tests).
- `SCHEMA` (currently 4) is stored on the config doc. Bump it when the stored
  shape changes.

### Connecting (`initSync` → `connectWith`)

1. Load the SDK, then try connection `STRATEGIES` in order: `long-poll` with a
   persistent IndexedDB cache, then `long-poll-nocache` with a memory cache. iOS
   standalone apps often can't use the default streaming transport. Each attempt
   uses a fresh named Firebase app, because Firestore settings are immutable.
2. `loadRegistry` reads `_index` to find `YEARS`, `liveYear` and `activeYear`.
   `activeYear` is remembered in `localStorage["ei-year"]`.
3. `seedIfNeeded`: a **brand-new** tournament doc gets the in-memory defaults
   and demo games. For an existing tournament, games are only repaired if they
   are in an old shape. **Missing games are never re-created**, because their
   absence means they were deleted.
4. Three `onSnapshot` listeners: `_index`, the config doc, and the games
   collection. The games listener **rebuilds `GAMES` from the snapshot**
   rather than merging into it, so deletes take effect.
5. `startWatchdog`: if there's no server data after `CONNECT_TIMEOUT` (25s),
   escalate to the next strategy once. After that, leave Firestore to retry
   on its own. `kickServer`/`kickGames` force `getDocFromServer` and
   `getDocsFromServer` reads, because Firestore will otherwise serve a stale
   cache indefinitely.
6. A transport that worked and supports offline is remembered in
   `localStorage["ei-transport"]`. Only transports that keep offline queueing
   are remembered — remembering the no-cache fallback once lost offline support
   permanently.
7. Every attempt has a generation number (`gen`). Callbacks from an older
   attempt are ignored.

`SYNC.state` is one of `local | connecting | live | offline | error` and is
shown in the `#syncdot` pill. `touchSync` tracks cache vs. server per
listener, so a warm cache doesn't count as "offline".

### Writes

- **Scores go through a durable queue.** `pushHole(g, h, path, value)` calls
  `enqueue()`, which saves to `localStorage["ei-queue"]`. Only the newest
  write per field is kept, and the queue is capped at 500 entries. Then
  `flushQueue()` runs `updateDoc(gameRef, { "holes.{h}.{path}": value })`.
  Single-field writes let two phones scoring different players or holes
  merge cleanly.
  - The queue flushes on connect, every 8 seconds, and on the `online`
    event. If a doc is missing or invalid, the whole game is rewritten.
  - `applyQueueLocally()` re-applies unacknowledged writes on top of every
    incoming snapshot, so pending scores never disappear from the screen.
  - The queue exists because Firestore's IndexedDB cache fails on some phones,
    and scoring has to work with no signal on the course.
- **Whole game**: `pushGame(g)` uses `setDoc`, for resets, roster changes and migrations.
- **Delete**: `removeGame(gid)` deletes the doc, drops queued writes for that
  game, and adds a tombstone to `deadGames` for 2 minutes. This stops a stale
  snapshot from bringing the game back.
- **Config** (players, courses, schedule, days): `queueConfig()` sets
  `cfgDirty` and debounces `pushConfig()` by 700ms, which does a `setDoc(..., {merge:true})`
  including `appBuild: BUILD`. While `cfgDirty` is set, incoming config
  snapshots are ignored because the local copy is newer. A failed write retries
  once and then clears `cfgDirty`, so the phone doesn't stop listening.
- **Stale-device guard**: if the config's `appBuild` is newer than this page's
  `BUILD`, `staleDevice = true`. All writes become no-ops and a banner asks the
  user to update. This stops old cached builds from undoing other people's work.
- **Archive years**: when `isArchive()` is true, all push helpers return early,
  so past years are read-only.
- `migrateLoaded()` repairs data written by older builds on load (missing ids,
  legacy `round` strings, array `teams`, orphaned games) and writes the fixes back.

## Testing

```sh
npm install jsdom            # anywhere on NODE_PATH; no package.json in the repo
node ei-tests.js index.html  # the default path is a stale /mnt/user-data/... location, so always pass the file
```

The suite loads the real page in jsdom (Firebase never connects there, because
the dynamic `import()` fails and the app stays local), clicks through every
screen, checks the scoring maths, and has one regression test per bug.
The rule written in the file is that every bug gets a test on the same day.

Test numbers are **not** in file order — R65–R74 sit after R83–R100 — so take the
next free number from `grep -oE '"R[0-9]+' ei-tests.js | tr -d '\"R' | sort -n |
tail -1` rather than from whatever precedes your insertion point. Two batches
have collided this way already.

Current status against `index.html`: **163 passed, 0 failed**. The suite is
green — a red run means your change broke something, not drift. If you change
markup a test selects on, fix the test in the same commit.

Beyond the per-bug regressions there are a few structural guards worth knowing
about, because they fail for reasons that aren't about the code you just wrote:

- **R69** fails if a test leaves the tournament a different shape than it found
  it. Wrap anything that replaces `SCHEDULE`/`GAMES` in `isolate()`. A test
  that forgot this once left every later test running against a one-game
  tournament, which is how a batch of deletion bugs got through a green suite.
- **R49** fails if any function is defined twice — three were, 105 identical
  lines apart, and the later definition silently won.
- **R31** fails if a click handler has no markup that can trigger it.
- `t()` is synchronous. Anything that awaits goes through `ta()`, or its
  assertions run after the test has already been counted as passed.

## UI decisions that look odd and aren't

Three things in the view layer are deliberate and will look like mistakes:

- **The course picker is drawn with the app's own buttons, not a `<select>`.**
  Two attempts at a native select — one with `appearance:none` for a custom
  arrow, one with the system control untouched — both rendered the chosen
  course as an empty box on the owner's iPhone. R60 fails if a `<select class="sel">`
  comes back. The current course name is also printed in the heading so it is
  readable whatever a form control does.
- **Time is `<input type="time">`.** That one *is* native, on purpose: it gives
  the iPhone wheel, every minute, and its value is already the `"HH:MM"` the
  schedule stores. The field does **not** re-render while it's being used —
  redrawing mid-spin shuts the wheel.
- **Long screens are collapsible sections** (`panel()`, `openPanel`), one open
  at a time per screen. The Field tab was 66 input fields on one scroll. Tests
  that need a control inside one call `openSection("f:card")` first.

## Conventions

- Keep everything in `index.html`. Don't add a bundler, framework or extra JS
  files without asking.
- Comments explain *why*, often naming the bug that caused the code. Match
  that density and tone.
- Sync must never block the UI. Local state and the screen update first, and
  failures only affect sending.
- Bump `BUILD` for every change you ship. Bump `SCHEMA` and add a
  `migrateLoaded` step whenever the stored shape changes.
- Never write code that recreates deleted data (games, rounds) or overwrites
  `_history` or an existing config wholesale. Several past bugs were exactly that.
- Deleting is asynchronous and snapshots keep arriving, so `removeGame` keeps a
  tombstone in `deadGames` for two minutes and both the listener and
  `kickGames` filter against it. Without that a snapshot sent before the delete
  landed puts the game straight back.
- When you fix a branch that was wrong for one game type, grep for every other
  place that branches the same way. "Why do both scrambles show 0/40" was fixed
  once in the scorecard header and left unfixed in the card label for weeks,
  because only the reported screen was looked at.
