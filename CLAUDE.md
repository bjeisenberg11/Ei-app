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
    - **Or scored on points when `g.points` is set** (R145): 5-3-1-0 by place
      (`PLACE_PTS`), a side's own **birdie doubles** its points and **eagle or
      better triples** them, ties split the points for the places they cover.
      Skins pays only the top two, so a side that keeps finishing third can be
      out of it by the turn; points keeps all four in it. Same machine as
      skins — `holeSkins` returns twelfths for both (every split, ×2 or ×3,
      still divides into twelve), so **`isSkins` is true for both** and
      totals, ranking, grid, card and top-two-through are shared. `isPoints`
      picks the per-hole sum and the words (`unitWord`). The two flags are
      never set together: the roster chip cycles stroke play → skins → points,
      and the CSV notes take `Points` (checked before `Skins`).
    - `g.tees` is a per-side tee name (`{0:"Black",1:"Blue",…}`) for a
      four-team game, since the teams are levelled by the boxes rather than by
      handicaps and the same man plays a different tee depending on his
      partner. It is **display only** — `teeNameIn` uses it, `courseHcp`
      never does, and these formats take no handicaps anyway.
    - `g.ptees` is a tee name **per player** (`{p2:"Blue", p8:"Yellow"}`), for a
      side levelled by splitting its pair across two boxes — Dan off Blue with
      Adam off Yellow — which a tee keyed by side cannot say. Precedence in
      `teeNameIn` is **man → side → Field tab**. Also display only.
      - It lives on the game rather than on the Field tab for a reason: a
        player's tee there is stored **per course**, and Hammock Bay also hosts
        the morning `WOLF5`, which *is* scored on net. Moving Dan to Blue on the
        Field tab to fix the afternoon card would have handed him a Blue course
        handicap in the morning game. R136 guards that.
    - All three ride in the GAME row's **`notes`** column as words — `Skins.
      Tees: Blue / Dan Blue + Adam Yellow / Members / Red` — rather than more
      format suffixes, and `scheduleToCSV` writes the same sentence back. Each
      `/` chunk is a box for the whole side, or `Name Tee + Name Tee` for the
      men on it, or `own` to leave the side on each man's own tee. The tee in a
      chunk is matched **from the end**, because both names can be more than one
      word. Naming a man who isn't on that side is an import error rather than a
      silent no-op, since the tee would simply never be read.
  - `FORTYBALL`: "40ball". Each team must count exactly 40 net scores across
    18 holes, chosen hole by hole and committed by locking the hole.
    - **Simultaneous reveal, per hole.** The advantage in 40ball is locking
      second and knowing the other side's answer — not seeing picks as such.
      So nothing is hidden while both sides are deciding (symmetric, same
      green); the moment a side locks, its ticks **and its count** go dark;
      when the other side locks, the hole opens for good. `fbRevealed(g,h)` is
      `locked[0] && locked[1]`.
      - **Needs no sign-in**, because the only thing ever held back is an
        answer its owner has already given and can't change. A team never
        needs to see anything it can't.
      - Every readout comes in two flavours. **Truth** (`fbSpent`, `fbBudget`)
        drives min/max and the Lock button — a side must never be let past 40,
        whoever has locked. **Shown** (`fbShownSpent`, `fbTotal(g,t,true)`,
        `fbParBasis(g,t,true)`) is all a screen may print: the corridor, the
        team head, the banner, the games-list status and the text export.
        "Remaining 38" gives a two-score hole away exactly as plainly as two
        ticks, which is why the count has to seal with them. Anything new that
        prints a 40ball number must use the shown flavour (R138).
      - The **fact** that a side has locked isn't secret — the card says the
        hole is sealed and waiting. Only what it spent is.
      - **Slack** ("6 holes of slack") is planning, so it's shown-flavour too:
        holes this side has locked against what it's *shown* to have spent, so a
        sealed hole counts as nothing taken — conservative, and immovable by
        what was taken. Off the truth it read 7 vs 8 depending on the sealed
        pick, which leaked the count as plainly as "Remaining" would; R138
        checks a sealed 0, 2 and 4 read identically.
      - **Accepted residual:** "must take at least N" / "you must take all N"
        are rules about the hole in front of you and stay on the truth — a rule
        shown wrong is worse. If one team is a hole ahead with it still sealed,
        an opponent doing arithmetic on those lines in the last few holes could
        back out the sealed count. Closing that needs the card to know whose
        phone it is.
      - History: an earlier `hidden` flag was set on every game, toggled in the
        roster editor and labelled on the games list, and nothing read it. It
        was removed rather than left saying something untrue; older docs may
        still carry the field.
  - `WOLF5`: "5-man Wolf", for the Thursday-morning fivesome. **The only format
    whose sides change hole to hole**, so `SIDES.WOLF5 = 1` and `teams[0]` is
    the whole field in tee order. Nothing may read `g.teams` beyond the roster;
    who is against whom lives on the hole.
    - Played **net, on best ball** (`usesHcp` includes it). A halved hole pays
      nobody and **nothing carries**.
    - Points: the wolf's three win → **1 each**; the two he left out win →
      **3 each**; a lone wolf wins → **8**; a lone wolf loses → **2 to each of
      the other four**.
    - The wolf is the **last man to tee off** and rotates: hole `h` belongs to
      `roster[h % 5]`. Only an override is stored (`holes[h].wolf`), because
      writing the default into 18 holes is 18 writes saying nothing. 18 over 5
      isn't whole — the first three are wolf a fourth time — so the wolf is
      editable on every hole rather than the remainder being a rule.
    - Who he took is **two fields, not one**: `pack` fills up as names are
      tapped, so it passes through a half-made state of one man that must not
      score as a 2v3; `lone` is its own flag because "went alone" and "hasn't
      decided" are different and an empty `pack` can't say which. `wolfPack()`
      resolves them to the pair, `[]`, or `null`.
    - `teamOutcomes` returns **null** — five men on their own points, no sides
      to hand a W/L to. `standings()` already drops a game whose outcomes are
      null, so a wolf game can't reach the record even if someone puts one on a
      sanctioned round. The result's `winner` is a **player id**, not a side
      code; `winnerLabel` resolves either.
    - The banner is the one case where the box is **not** a repeat of the card:
      the hole strip can only say which holes are settled, so the points per man
      appear nowhere else and the box stays up all round.
    - Like `counts`, the new per-hole fields are **absent-means-undecided**, so
      older games read out of Firestore are unaffected and there was no `SCHEMA`
      bump.
    - **"Draw for order"** shuffles `teams[0]` (Fisher-Yates, not a random
      `sort` comparator). Because the rotation *is* the tee order, the draw also
      picks who starts as wolf — one button for both. It's a roster change, so
      it goes through `pushGame`, and it disappears the moment anything has been
      entered: by then the order is a fact about holes already played off it.
      The **first draw is one tap; a redraw asks** ("Redraw the tee order?",
      listing the current one), and the button reads "Redraw order". `g.drawn`
      is stored on the game so every phone asks, not just the one that drew;
      absent means never drawn, so no `SCHEMA` bump.
    - **Tee order is shown on every hole** (`wolfTeeOrder`, R147): everyone
      moves **down** one place a hole and the wolf tees first on the next
      (Blake Jake Daniel Dan Jason → Jason Blake Jake Daniel Dan). The roster
      is the wolves in turn, so a hole's order is the roster read backwards
      ending on its wolf — hole 1 is roster 5,4,3,2,1. The first build moved
      it up a place; the group plays it down. It is
      **derived, never stored**, so it was added mid-round without a write. A
      changed wolf still tees last and the other four keep their rotation
      places. The "Takes" chips run in the same order, since he decides on each
      man as that man hits.
    - **"Change" sets the order by hand** (`teeSet`, R148): tap the five as
      they teed off on hole 1 (four taps; the fifth fills in), confirm, and the
      roster becomes the hole-1 order **reversed** so `wolfOn` and `wolfTeeOrder`
      agree with the tee. Unlike the draw it stays **available mid-round** —
      it records what happened rather than rolling something new. It writes
      through `pushWolfOrder`, an `updateDoc` of **`teams.0` and `drawn`
      only**, never `pushGame`: a whole-game `setDoc` from one phone's copy
      mid-round could wipe a score another phone just sent. Hole-level wolf
      overrides survive it; unoverridden holes re-derive their wolf.
    - CSV: `WOLF` / `WOLF5` / `5-man Wolf`. A **one-sided** game's names are read
      and written **straight across** every name cell in the row, because five
      men don't fit one side's four columns. Both `parseCSV` and `scheduleToCSV`
      have to agree on that or the roster is lost on a round trip.
- **Handicaps**: course handicap = `index × slope/113 + (rating − par)`,
  calculated per course and tee. A player's tee is stored per course. A round's
  `mode` is either `RELATIVE` (strokes off the lowest player in the game) or
  `FULL`.
- **Sanctioned rounds**: a round carries `counts`. `counts === false` means it's
  on the schedule and scored like any other, but **excluded from `standings()`
  and `pairMatrix()`** — not as a win, not as a loss, not even as a game played,
  since counting a played game with no result would drag win% down. 2026's
  Thursday-morning fivesome at Hammock Bay is the case it exists for, and the
  Saturday-afternoon 3v3 at the Rookery is casual too (R144).
  - The Board's footnote names casual rounds by **day, time and course**,
    because two rounds can share a course on one day — Saturday has two at the
    Rookery — and "Rookery at Marco" alone couldn't say which was left out.
  - **Absent means sanctioned** (`roundCounts = r => !r || r.counts !== false`),
    so rounds from older builds and every past year read out of Firestore keep
    their records. That's why there was no `SCHEMA` bump.
  - Use `gameCounts(g)`, which resolves the round with `EV(g.roundId)` and
    **not** `roundOf(g)` — the latter falls back to `ROUNDS()[0]`, which would
    make an orphan game inherit whatever flag the first round happens to have.
  - The flag is on the **round**, never the game: a round can hold several games
    and it's the round that is or isn't part of the tournament.
- **Ending a game early** (R150): a match conceded before the 18th, or a round
  rained off. `g.ended = { how, after, at }`, `how` one of **`final`** (the
  result as it stands — `resultAsItStands`), **`tie`** (a T and a game played
  for every side, four teams included) or **`void`** (no W/L/T and not a game
  played, the casual-round rule). The group has settled rain-outs both ways, so
  the choice is made when ending, not fixed. Absent means the game runs its
  course: no `SCHEMA` bump.
  - `gameResult` checks `ended` first and otherwise calls `playedResult` (the
    per-format results). A void game's result is `{ winner:"VOID" }` — anything
    that prints a winner must check for it before `winnerLabel`.
  - Stopped games are compared on **to par**, not gross, because sides are
    often on different holes. `teamOutcomes` ranks multi-team stroke play on
    to par for every game now; for a finished round that orders sides exactly
    as the gross does.
  - Written through `pushGameFields(g, {ended})`, an `updateDoc` of that field
    only — never `pushGame`. Reopen writes `ended: null`.
  - The control is a quiet "End game early" link at the foot of the card,
    shown once something's been played and the game hasn't finished on its
    own; `endOpen` (a game id) opens the three choices, each confirmed.
    Scores stay editable after ending. The pairings matrix still counts a void
    game: the men did play together.
- **Board tab**: the leaderboard for the year (W/L/T, ranked on points) and
  a **History** view. The 3v3 scramble is **not an EI game in any year**: the
  2024 and 2025 records (`HISTORY_SEED`, and the live `_history` doc, which
  is corrected through the History paste box, never by code) have it taken out
  — Blake/Jake/Adam a win and a game fewer each year, Daniel/Dan/Jason a loss
  and a game fewer. That made 2025 a three-way tie (Adam, Dan, Howard at 3-1)
  where it had been Adam outright. The paste box refuses a year only when the
  app really has that year's games (`source === "played"`), not merely
  because the year is registered.
  History combines years the app scored with years from
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
- **Flights**: each Travel section opens on **`flightForm(dir)`** — who, airline,
  flight #, time, day — and that is the main way in (R140). The paste box is the
  second way, behind a link under the form.
  - Airlines are **buttons, not a `<select>`**, for the same reason the course
    picker is (R60). "Other" opens a box for the name. The number box is
    `inputmode="numeric"`, and only its digits are kept, so "MX 410" is 410.
  - The time is `<input type="time">`, labelled **Lands** for an arrival and
    **Takes off** for a departure. No time is a real answer (TBD), not a refusal.
  - Half-filled state lives in **`flightDraft[dir]`**, not the DOM, because
    every chip tap redraws the screen and a number typed a moment earlier has
    to survive it. Typing and the wheel write to the draft and **never
    redraw**. Save also reads the boxes directly: iOS doesn't always fire
    `input` when the keyboard is dismissed by tapping a button.
  - Who defaults to `myId()`. After a save the draft clears except **who**, and
    an arrival seeds the departure form's who too — the next flight from that
    phone is almost always the same man's other leg. Arrivals default to the
    first day, departures to the last. Unlike the paste route, a save doesn't
    open the event: there's nothing left to correct.
  - The old "Enter it by hand" button (the generic event editor) is gone; an
    existing flight still opens that editor when tapped.
  - **Track ↗** on every flight card links out to its live status
    (`flightTrackUrl`). Not a tracker built in: live status needs a paid
    flight-data service, and with no server its key would sit in the page
    source. FlightAware's canonical ident is **ICAO** + number (`UAL2137`, not
    `UA2137`), hence `AIRLINE_ICAO`; an airline outside it falls back to
    Google's flight-status search, and a title with no flight number gets no
    link at all (R143). It opens in a new tab so the app stays put.
  - `parseFlight(text)` reads a confirmation line — airline and number,
  both airports, both times, the day — and `flightNotes` builds the route line
  from whatever it recognised. It never rejects anything: an unreadable paste
  still makes an event with the text as its title, which is no worse than the
  blank one you'd have got, and the event opens straight after so anything it
  missed is one tap away.
  - The trap it exists to avoid: `ORD 10:51` looks exactly like a carrier code
    and a flight number. The flight number is matched **first** and its text
    struck out of the line before airports are read.
  - An arrival is filed at the time it **lands**, a departure at the time it
    **takes off** — the schedule is of things happening there.
  - `myId()` / `setMe()` keep the last player picked on a travel event in
    `localStorage["ei-me"]`. There is no sign-in; picking who a flight belongs
    to is the closest thing, so the next flight from that phone needs no tap.
  - The schedule's admin unlock is a thin `.lockmini` line, not a bar with a
    password field in it (`showUnlock` opens the real one). Almost nobody
    opening that screen is about to unlock anything — they want a tee time or
    their own flight, and a non-admin can already do both.
- **Admin mode**: unlocked with `ADMIN_CODE` (`"eagle"`, in the page source).
  It guards against mis-taps and is **not** a security boundary. With no
  Firebase config, admin is always unlocked.
- **Events** (R151, R152): three kinds — the **EI** (one per year), a **golf
  trip**, and a **single game**. Only the EI's years reach the EI record and
  History; a trip has its own players, courses, schedule and Board; a single
  game is one round today and the round editor, opened with "Games in this
  round" unfolded. A single game is **never asked for a name**: it's named after
  its first game — format, the day it was started and who's playing
  (`gameAutoParts`) — and `syncGameName` writes that back to its config and
  the registry so the Events list agrees with the header. The header shows the
  format big and "date · players" under it. Every format works in all three, and `WOLF5` is now in the
  "+ game" buttons.
  - **Saved players and courses** (`LIB`, R153) live at `tournaments/_library`
    as two **maps keyed by id** (`{ players:{p1:…}, courses:{pine:…} }`), so a
    merge write of one entry can't lose another phone's. Every event keeps its
    **own field** (`PLAYERS`/`COURSES`, which handicaps, tees and the Board
    read); the library is what a new one picks from. `libAbsorb(onlyMissing)`
    puts the field into it: missing-only on load (an old event must never push
    a stale index over a newer one), changed entries on `pushConfig` (a real
    edit). It waits for the library snapshot (`LIB.loaded`) before writing,
    and never runs from an archive.
    - **Never send an empty map to `_library`** (R158). A merge write takes
      `{ players: {} }` as "players is now empty" — adding the EI's courses
      once went up with an empty players map and wiped every saved player.
      Every write goes through `libWrite`, which drops an empty half, and the
      listener runs `libAbsorb(true)` on **every** snapshot so a list that
      lost entries refills from whichever event's field is open.
    - **Nothing reads the field as this event's until its config has loaded**
      (`fieldReady()`, `cfgFor`, R161). Until then `PLAYERS`/`COURSES` are the
      demo field (on open) or the last event's (after `switchYear`). The saved
      list once filled itself from the demo players a moment before the EI
      arrived, so it showed Blake 8.2, Jake 3.1 and so on. `libAbsorb`, `libPull`,
      `libDedupe`, `libSavePlayer`'s field write, `freezeIndexes` and
      `pushConfig` all check it. `libRepairDemo` puts real players back over
      demo copies and
      drops the invented demo courses; `freezeIndexes` re-locks a game whose
      `idx` is all demo values when the field disagrees.
      `looksDemo` judges by **name and index** (`demoIndexFor`), saved before
      `DEMO_FIXED_AT`: matching on id and an untouched copy fixed two of eight,
      since the other six had been re-saved — stamped, or under an id the EI
      doesn't use — still carrying the demo number. The EI's man of that name
      replaces the copy (under the EI's id; the stray id is deleted and "me"
      follows), and `libPull` never brings a demo copy into a field.
  - **New trips and games start with an empty field.** Outside the EI the
    course picker and the roster editor list saved courses and players after
    the event's own; picking one brings it in (`fieldAddCourse`,
    `fieldAddPlayer`). The Field tab adds saved players in one tap, adds a
    **New player** (name + index; a name already saved brings that man back
    rather than a duplicate), and can remove someone who's in no game. The EI's
    pickers keep to its own field.
  - A **single game's round editor** has no Type chips and no "counts toward",
    and takes a calendar date (`<input type="date" id="evdate">`, no redraw
    while the wheel is open, like the time): `setGameDate` sets `round.date`,
    `round.day` (`dayLabel`, weekday in it for `todayDay`) and `DAYS = [day]`.
    The auto name's date comes from `round.date`.
  - Outside the EI there's **no admin lock bar** on the Schedule or Field tab.
  - **A single game has no Schedule tab** (R155): `render()` hides the tab
    and sends a closed round editor back to Games. Its round is opened from
    **Set up the game / Edit game** (`data-editround`) under it on the Games
    tab; its round editor has no Delete (that would leave an empty game), and
    the Games tab has no All days / Just today bar.
  - **Deleting** a trip or game (`deleteEvent`, R154, R155; a Delete beside
    each trip and game row on the Events screen, so nothing has to be opened
    first; confirmed, never offered for an EI year) deletes its games,
    then its config, drops it from `events` and adds its id to the registry's
    **`deleted`** list (arrayUnion). `readEvents` filters on that list —
    without it every phone that had seen the event would put it back, since
    phones keep events a cached registry doesn't list yet. A phone sitting in
    an event deleted elsewhere is moved back to the live EI. Saved players and
    courses stay.
  - **One Firestore per app** (`firestoreFor`, R154). Switching events calls
    `connectWith` again on the same app, and a second `initializeFirestore`
    there throws `failed-precondition` (its options carry a fresh cache object,
    so they never compare equal). That showed as "Sync error" after the second
    switch, with nothing loading or saving. Never call
    `fsMod.initializeFirestore` directly in `connectWith`.
  - `activeYear` keeps its name but holds an **event key**: an EI year
    (`"2026"`) or an id (`"x-k3f9a2"`). `isEIKey`, `isEI()`, `eventKind()`,
    `tidFor(k)` (`ei-2026` or the id itself). `YEARS` is EI years only, which
    is why History needed no change; `EVENTS` holds the rest, `knownKeys()`
    both.
  - EI years still work exactly as before: past years are read-only archives
    (`isArchive` is EI-only — a trip is never frozen), and "Start the next EI"
    (Field → Danger zone, or the Events screen, admin) copies players and
    courses from the **live EI**, not from whatever event is on screen.
  - **Admin**: `canSetup()` = `isAdmin || !isEI()`. The code guards the EI from
    mis-taps; a trip or game needs no code to set up. History stays `isAdmin`.
  - **The Clubhouse** (`view.tab = "club"`, `renderClub`, R156; `"events"` is
    an alias) is the screen above every event and where the app opens. The live
    EI is one big card (its "Now: … thru N" line only when the live EI is the
    event loaded — other events' games aren't in memory), past years and
    History beside it, then golf trips and single games (each with Delete), then
    **+ Single game / + Golf trip**. Inside an event the tabs are Games /
    Schedule / Board / Field; **Back reads "‹ Clubhouse"** at an event's top
    level, and the EI square (`#toclub`) goes home too. On the Clubhouse and
    settings `body.clubmode` hides the event tabs. Share a link and (admin)
    "Make this the one everyone opens" sit at the foot of an event's Games tab.
  - **Where it opens**: **always the Clubhouse** (R160). `maybeLandInEvent`
    goes into the event only when the page came from a shared `?e=` link,
    and never once the user has tapped (`userMoved`). It used to land in an
    event with a game under way or a single game dated today; the morning
    after the EI that put everyone back inside a finished weekend.
  - **You & settings** (`view.tab = "settings"`, `renderSettings`): who this
    phone is (`meId()`, `localStorage["ei-me"]`, checked against the saved
    list), **your handicap index** with Save (`libSavePlayer`), the saved
    players and courses, EI admin unlock, Check for update and the build line
    (moved off the Games tab).
  - **Same-name saved players merge** (`libDedupe`, R157): kept is the one
    this event's field uses (else the oldest), with the newer index of the
    pair; the others are removed from `_library` (`deleteField`) unless they're
    in this field, and a phone's "you" pointing at one moves to the keeper. It
    came from "Add me" being used before the list loaded, which made a second
    Blake — so `mecreate` now refuses until `LIB.loaded`, and checks the
    event's field names as well as the saved list.
  - **Indexes lock per game** (`g.idx`, `freezeIndexes`, R156): a handicap
    game's players' indexes are copied onto it at its **first score** (in
    `pushHole`), and `courseHcp(pid, course, g)` reads them from there
    (`indexIn`). So an index change reaches games not yet started and never
    rescores one already played. `freezePlayed()` locks games scored before
    this existed on load — the 2026 EI as played. Absent means unlocked: no
    `SCHEMA` bump.
  - **The saved list and an event's field stay in step by timestamp**: an edit
    in an event is an entry that differs from `fieldBase` (the field as loaded
    or last sent); `libPushEdits` (from `pushConfig`) stamps those with `upd`
    and sends only them, so an old copy can't overwrite a newer one; `libPull`
    takes any saved entry with a newer `upd` into a non-archived event (after
    `freezePlayed`, and not while `cfgDirty`). `startYear` carries the newer
    of the live EI's copy and the saved one.
  - **Landing** (`landingKey`): a `?e=` link wins; then the registry's `open`
    event, but only the first time this phone sees it change
    (`localStorage["ei-open-seen"]`); otherwise wherever this phone last was.
  - **Two cross-event write hazards, both fixed in `switchYear`/the queue**: a
    setup change still in its 700ms debounce is pushed to the event being left
    before `activeYear` changes, and queued scores carry `ev` so `flushQueue`
    sends them to their own event's game even after a switch.

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
tournaments/_index                 { years: ["2025","2026"], live: "2026", open?: key, deleted?: [ids],
                                     events?: [{ id:"x-…", kind:"trip"|"game", name, at }] }
                                   — always written with merge: a wholesale { years, live } loses the events
tournaments/x-{id}                 a trip or single game: same shape as a year's config plus { kind, name },
                                   with its own games subcollection
tournaments/_library               { players:{ id:{…} }, courses:{ id:{…} } }  saved for every event — merge writes only
tournaments/_history               { years: { "2021": { rows:[{name,w,l,t,gp}] }, ... } }  pre-app records
tournaments/ei-{YEAR}              config: { schema, appBuild, players, courses, schedule, days }
tournaments/ei-{YEAR}/games/{id}   one doc per game: { id, roundId, type, teams:{0:[..],1:[..]}, oneGroup?, holes:{ "0":{...}, ..., "17":{...} } }
                                   (older 40ball docs may carry a dead `hidden` field — nothing reads it;
                                    the reveal is derived from `locked`, nothing extra is stored)
```

Each hole is `{ scores:{pid: n|"PU"}, teamScore:{0..3}, conceded, selected:{0:[],1:[]}, locked:{0..3} }`.

**Sides are not always two.** `SIDES[g.type]` gives the count, and
`sides(g)` / `sideCount(g)` / `isMulti(g)` are the only correct way to iterate
them — `teams` runs 0..3 for a `SCRAMBLE2X4` and is a single side of five for
`WOLF5`. Most bugs in this app's history are some helper hardcoding `[0,1]` or
`locked[0] && locked[1]`; before writing either, check whether a four-team game
*or a one-sided one* can reach that line. **`rosterOf(g)` is how you get
everyone in a game** — `baseline`, `strokesHereLine` and `renderStrokeGrid` all
spread `teams[0]` and `teams[1]` instead, which was invisible until Wolf became
the first format with a side count other than two that takes handicaps (R132).

A `WOLF5` hole also carries `wolf`, `pack` and `lone` (see the format notes
above). It has no `teamScore` and never locks, so anything keyed off `locked`
has to let it past — `holeComplete`, `currentHoleFor` and the hole strip all
branch on `isWolf` for exactly that reason.

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

Current status against `index.html`: **199 passed, 0 failed**. The suite is
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

## The scorecard screen

- For a format with one team score per hole (`isStroke` — both scrambles and
  the 2v2v2v2 alike), the top of the card is **`holeGrid(g)`**: one strip of
  all eighteen holes with a row per side, scrolling sideways inside `.hgwrap`,
  the label column and the total column both `position:sticky`. It was folded
  into two nines once — that halves the width but doubles the height, and the
  back nine sits empty all morning. `syncHoleStrip()` runs after `renderGame()`
  and scrolls the hole being scored into the middle; without it the strip sits
  on hole 1 all afternoon. In a skins game each cell carries what the hole was
  worth under what was scored on it (`.hg-sk`), and the Tot column carries the
  skins total under the gross in that same small type — so a side's whole
  afternoon is one row. A **Par row** (`.hg-par`, R149) sits under the hole
  numbers with the course par in Tot, so an unscored hole still says what it
  is. It has no `data-side`, so it never joins the shuffle — and tests that
  want the sides select `.hg-row[data-side]` rather than every row past the
  heading. Match play and 40ball keep the plain 1–18 `.hstrip`,
  because neither has a single number per team per hole.
- **The leaderboard box only appears for a result.** While a game is live the
  card already carries every side's totals, so the box was the same numbers
  twice on one screen; `.cardcap` is one line in its place. Where each side
  stands is a `.hg-rk` badge beside its name, filled dark for the ones going
  through. The rank is worked out on **to par**, not gross, so sides different
  numbers of holes in still compare honestly (R100).
- **The card's rows sit in standings order and re-order as it changes**, with
  a leaderboard shuffle: `render()` calls `captureRows()` before the DOM is
  replaced and `animateRows()` after, which puts each row back where it was and
  releases it (R127). Rows are matched on `data-key` = game id + side, so
  nothing animates across a game change, and the two `requestAnimationFrame`s
  are needed — releasing in the same frame collapses to no animation.
  **Offset with `top`, never `transform`**: a transformed ancestor becomes the
  containing block for `position:sticky`, which would unpin the name and total
  columns for the length of the animation. `prefers-reduced-motion` skips it.
  - Three ways this breaks **silently** — the rows still land in the right
    order, they just arrive without having moved, so it reads as "animations
    aren't working". All three are guarded at the source in R127, because jsdom
    has no layout to measure. (1) The start position must be forced into layout
    (`void r.offsetHeight`) before it's released; `requestAnimationFrame` runs
    *before* layout, so two frames are not enough and the browser coalesces
    both values into one style. (2) Release to an explicit `top:"0px"`, not
    `""` — empty computes to `auto`, and a length will not interpolate to
    `auto`. (3) No `transform`, as above.
  - It only fires on the tap that **completes** a hole, since skins aren't
    awarded until every side is in. Three taps in four move nothing, which is
    correct and looks like nothing happening.
  - The sort is safe **here and only here**. The entry blocks below stay in
    side order: that's where the steppers are, and a block that moves between
    taps loses your place. A row is therefore one flex element with fixed
    column widths rather than twenty grid children, so there is something to
    move.
- In a **skins** game a cell is two banded halves, skins above and strokes
  below on a tint, with the legend in the corner where "Hole" would be. Two
  numbers stacked at different sizes read as one value and a footnote; two
  bands read as two columns of a scorecard, which is what they are. The
  current-hole column has to tint **both** bands — the strokes band paints its
  own background over the column's.
- Otherwise a cell has two slots, `.lead` and `.sub`, and **what the game is
  decided on leads**: in a skins game the skins lead and the stroke trails; in a scramble
  the stroke leads and to par trails. Same order in the total column. The
  classes say what a number *is* (`.hg-v` strokes, `.hg-sk` skins, `.hg-rel`
  to par) and `.lead`/`.sub` say how big it's drawn, so the two don't get
  tangled when a format flips the emphasis.
- Both slots are drawn in **every** scored cell — a hole that paid nothing
  still shows a muted `0`. Filling a slot only where there was something to
  say made those cells two lines and the rest one, so numbers sat at different
  heights along a row.
- **Nothing on a grid is labelled with a truncated name** (R126). A row is
  `gridName(g, t)`: both names for a pair, and for a side of three or four
  every man, two to a line in the column's small capitals ("Adam, Howard," over
  "Blake & Dan"). It used to be "Blake's team", which credited one man with
  the other three. The pairings matrix headings are whole names turned
  vertical (`th.pmn span`, `writing-mode:vertical-rl` plus a 180° rotate) —
  four letters made Dan and Daniel the same column while the row labels beside
  them were full names, so the two halves of the grid disagreed about who was
  who.
- **Scores are coloured against par everywhere they appear** — `.under` red,
  `.over` blue (`--over`), par plain — including the number inside the stepper,
  via `stepper(key, val, disabled, tone)`. `.banner.closed` needs its own
  lighter pair, since it's light-on-dark.
- A scramble team block is **head, stepper row, lock row**. There is no roster
  line: `teamLabel` already prints every name in the head, and repeating them
  underneath was two-thirds of the block's height saying nothing (R125). The
  tee chip moved up to the head with them, and shows **only where the game set
  a tee for that side** (`gameTee`). A 4v4 or 3v3 shows none: everyone is on
  whatever tee they always play, it decides nothing there, and four names each
  with a chip after them pushed the page wider than the phone (R99). The
  roster editor still shows every player's tee, which is where sides are
  picked and where it matters.

- **The games-list card is a little scoreboard** (`gameBoard(g)`): a row per
  side with its own number, the leader in bold, and a line under it for
  progress only ("thru 5", "4/40 · 3/40"). The status used to be one sentence,
  which had to name a side — and for three or four men the only short name was
  the first man's, so "Howard's team −7" credited one man with a four-man side
  (R142). Two-sided games keep side order; four teams and Wolf's five sort into
  standings. Best ball puts "2 UP" beside the pair it belongs to. Before
  anything's scored the card keeps the plain names and "Not started". 40ball
  reads the **shown** numbers only, so a sealed hole stays sealed here too.
  - The scorecard's sibling-game ticker (`renderOtherBug`) still uses the
    one-line `gameStatusLabel`, because a ticker is one line — so "X's team"
    can still appear there, for a round holding a 3v3 or 4v4 alongside
    another game. 2026 has no such round.
- **Rules behind an (i).** `gameRules(g)` explains each format in plain
  bullets; a small `#rulesbtn` after the game's name in the header opens it at
  the top of the card. The (i) is glued to the last word of the name (`.nw`),
  because on its own it wrapped onto a header line of its own. `rulesOpen` is a
  **game id**, not a flag, so moving to another game closes it (R141).
  - Every line must describe what the **scoring code actually does** — change
    a rule and change `gameRules` in the same commit, or the app will explain
    one game and score another. Handicap mode and "this round is casual" are
    read off the round, not written in.

- **There is no Test bar** (Random scores / Reset game). It sat on every card,
  one tap from wiping a live game; it was cut to the 2v2v2v2 so points could be
  tried before Thursday's round, then removed outright with `randomHole` once
  that round was under way. R146 fails if it comes back on any format.

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
- **The pinned Done/Cancel bar (`.stick`) sits on `--tabh`**, the tab bar's
  height as measured by `fitTabs()` on every render and resize (R159). A guessed
  58px left a strip on an iPhone that the "+ game" buttons scrolled through.
  A date input is held to `width:100%; min-width:0`, since iOS gives it a width
  of its own that ran past the card.
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
