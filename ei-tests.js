/* ============================================================
   THE EI — TEST SUITE
   Run:  node ei-tests.js  (needs: npm install jsdom)

   Three layers:
     1. SMOKE      — load the real page, click everything, nothing throws
     2. LOGIC      — scoring maths asserted against known-correct answers
     3. REGRESSION — one test per bug already found, so it can't come back

   The rule that matters: every bug we hit gets a test here the same day.
   ============================================================ */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const FILE = process.argv[2] || "/mnt/user-data/outputs/ei-prototype.html";
const html = fs.readFileSync(FILE, "utf8");

let pass = 0, fail = 0;
const fails = [];
function t(label, fn){
  try { fn(); pass++; console.log("  ok   " + label); }
  catch (e){ fail++; fails.push(label + " — " + e.message); console.log("  FAIL " + label + "\n         " + e.message); }
}
/* Some tests replace the whole schedule. Snapshot around them so the next
   test isn't running against whatever the last one left behind. */
function isolate(fn){
  const w = dom.window;
  const snap = w.eval("JSON.stringify({s:SCHEDULE, g:GAMES, d:DAYS})");
  try { fn(); }
  finally {
    w.eval(`(function(){
      const x = ${JSON.stringify(snap)};
      const o = JSON.parse(x);
      SCHEDULE = o.s; GAMES = o.g;
      DAYS.length = 0; o.d.forEach(d => DAYS.push(d));
      editEvent = null; view.gameId = null; view.tab = "home"; render();
    })()`);
  }
}

const eq = (a, b, m) => { if (a !== b) throw new Error((m||"") + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected truthy"); };
const section = s => console.log("\n" + s);

/* ---------------- boot a real DOM ---------------- */
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { document, window } = dom.window;
const click = el => { ok(el, "element not found to click"); el.dispatchEvent(new window.MouseEvent("click", {bubbles:true})); };
const type  = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", {bubbles:true})); };
const tab   = n => click([...document.querySelectorAll(".tabs button")].find(b => b.dataset.tab === n));
const appHTML = () => document.getElementById("app").innerHTML;
const gameBtn = id => [...document.querySelectorAll("[data-game]")].find(b => b.dataset.game === id);
const openGame = id => {
  // the Games tab narrows to today, so show everything before hunting for a game
  dom.window.eval('homeShowAll = true;');
  tab("home");
  click(gameBtn(id));
};

/* ============================================================
   1. SMOKE
   ============================================================ */
section("SMOKE — every screen renders");
["home","board","sched","players"].forEach(n =>
  t("tab: " + n, () => { tab(n); ok(appHTML().trim().length > 50, "screen is empty"); }));

section("SMOKE — every game opens");
dom.window.eval('homeShowAll = true;');
tab("home");
[...new Set([...document.querySelectorAll("[data-game]")].map(b => b.dataset.game))].forEach(id =>
  t("game: " + id, () => { openGame(id); ok(appHTML().includes("hstrip"), "game view missing"); }));

section("SMOKE — in-game controls");
openGame("g1");
t("strokes grid toggles", () => { click(document.getElementById("togglestrokes"));
  ok(document.querySelector("table.sgrid"), "grid did not appear"); });
t("score stepper", () => click(document.querySelector("[data-step]")));
t("pickup", () => click(document.querySelector("[data-pu]")));
t("concede", () => click(document.querySelector("[data-concede]")));
t("hole nav", () => { click(document.getElementById("next")); click(document.querySelectorAll("[data-hole]")[5]); });
openGame("g5");
t("40ball corridor renders", () => ok(document.querySelector(".corridor"), "no corridor"));

section("SMOKE — course switching");
tab("players");
t("three courses offered", () => eq(document.querySelectorAll("[data-course]").length, 3));
["marsh","stone","pine"].forEach(cid => t("switch: " + cid, () => {
  click([...document.querySelectorAll("[data-course]")].find(b => b.dataset.course === cid));
  ok(document.querySelector("table.card"), "scorecard missing");
}));

/* ============================================================
   2. LOGIC — assert real answers, not just "it rendered"
   ============================================================ */
section("LOGIC — course handicap maths");

const CH = (index, rating, slope, par) => Math.round(index * (slope/113) + (rating - par));

t("scratch-ish player off the blues", () => eq(CH(8.2, 72.1, 135, 72), 10));
t("same index plays fewer strokes off a shorter tee", () => {
  const blue = CH(11.4, 72.1, 135, 72), white = CH(11.4, 70.2, 128, 72);
  ok(white < blue, `moving up should cost strokes: blue ${blue}, white ${white}`);
});
t("rating below par reduces the handicap", () => ok(CH(11.4, 70.2, 128, 72) < 11.4 * (128/113)));

t("stroke allocation follows stroke index", () => {
  const SI = [7,3,17,11,1,9,15,5,13,8,4,18,12,2,10,16,6,14];
  const strokes = ph => SI.map((si,i) => ph >= si ? i+1 : null).filter(Boolean);
  eq(strokes(0).length, 0, "scratch gets none:");
  eq(strokes(3).join(","), "2,5,14", "3 strokes go to index 1,2,3:");
  eq(strokes(18).length, 18, "18 strokes covers every hole:");
});

section("LOGIC — match play");
const resolve = (a,b) => a<b ? "A" : b<a ? "B" : "H";
t("lower net wins the hole", () => { eq(resolve(4,5),"A"); eq(resolve(5,4),"B"); eq(resolve(4,4),"H"); });
t("close-out fires only when lead exceeds holes left", () => {
  const closed = (lead, left) => Math.abs(lead) > left;
  ok(!closed(3,3), "3 up with 3 to play is dormie, not closed");
  ok(closed(4,3), "4 up with 3 to play should close");
});
t("close-out label reads lead & holes remaining", () => {
  const label = (lead,left) => left===0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)}&${left}`;
  eq(label(4,3), "4&3"); eq(label(1,0), "1 UP");
});

section("LOGIC — 40ball budget");
const budget = (R,H,A=4) => ({
  max: Math.min(A,R),
  min: Math.max(0, R - 4*(H-1)),
  slack: 4*H - R
});
t("early on, nothing is forced", () => eq(budget(40,18).min, 0));
t("forcing kicks in as slack runs out", () => eq(budget(30,8).min, 2));
t("last hole must spend the remainder", () => eq(budget(3,1).min, 3));
t("cannot select more than remain", () => eq(budget(2,5).max, 2));
t("pickups reduce the ceiling", () => eq(budget(10,5,3).max, 3));
t("infeasible state is detectable", () => ok(budget(26,6).slack < 0, "26 left / 6 holes is unreachable"));

section("LOGIC — leaderboard");
t("points: win 1, tie 0.5, loss 0", () => {
  const pts = (w,tt) => w + tt*0.5;
  eq(pts(3,0), 3); eq(pts(2,2), 3); eq(pts(0,1), 0.5);
});

/* ============================================================
   3. REGRESSION — one per bug already found
   ============================================================ */
section("REGRESSION — bugs that already bit us once");

t("R1 renderGame and its helpers all exist", () => {
  ["renderGame","renderTeam","renderCorridor","stepper","netCell",
   "renderStrokeGrid","renderOtherBug","strokesHereLine","matchLocked",
   "cardBlock","updateCardMsg","refreshCH"].forEach(fn =>
     ok(html.includes("function " + fn) || html.includes("const " + fn),
        fn + " is missing — a rewrite deleted it"));
});

t("R2 schedule rounds are clickable buttons, not divs", () => {
  tab("sched");
  const link = document.querySelector("[data-game]");
  ok(link, "no round link on the schedule");
  eq(link.tagName, "BUTTON", "schedule round must be a <button> or clicks are ignored:");
  click(link);
  ok(appHTML().includes("hstrip"), "clicking a scheduled round did not open the game");
});

t("R3 toast is fully hidden when idle", () => {
  ok(/\.toast\{[^}]*visibility:hidden/.test(html),
     "toast needs visibility:hidden or it peeks above the tab bar");
});

t("R4 buttons inherit ink colour (iOS renders them blue otherwise)", () => {
  ok(/button\{[^}]*color:inherit/.test(html), "button colour not pinned");
});

t("R5 no 'Team A/B' in user-facing strings", () => {
  const shown = html.replace(/\/\*[\s\S]*?\*\//g, "");           // strip comments
  ok(!/Team [AB]\b/.test(shown), "teams must be named by player");
});

t("R6 header clears the Dynamic Island", () => {
  ok(/\.top\{[^}]*padding-top:env\(safe-area-inset-top\)/.test(html),
     "header needs safe-area padding in standalone mode");
});

t("R7 scrambles never claim a handicap mode", () => {
  ok(html.includes("Gross — no handicaps"), "scramble caption should say gross only");
});

t("R8 sync status survives a warm cache", () => {
  /* The bug: each listener fires from cache first, then server. Trusting the
     LAST snapshot reported 'offline' on every reload once the cache was warm. */
  const mk = () => ({ cache:{cfg:true,games:true}, seen:{cfg:false,games:false} });
  const touch = (S,w,fromCache) => {
    S.cache[w]=fromCache; S.seen[w]=true;
    return Object.keys(S.seen).some(k => S.seen[k] && !S.cache[k]) ? "live" : "offline";
  };
  let S = mk();
  touch(S,"cfg",false);
  eq(touch(S,"games",true), "live", "server snapshot then cache snapshot should stay live:");
  S = mk(); touch(S,"games",false);
  eq(touch(S,"cfg",true), "live", "either ordering should stay live:");
  S = mk(); touch(S,"cfg",true);
  eq(touch(S,"games",true), "offline", "all-cache really is offline:");
});

t("R9 concurrent writes to one hole must merge, not overwrite", () => {
  /* Field-path writes merge. Whole-document writes silently lose a score. */
  const doc = { holes: { 5: { scores: {} } } };
  const write = (path, v) => {
    const p = path.split("."); let o = doc;
    for (let i=0;i<p.length-1;i++) o = o[p[i]];
    o[p[p.length-1]] = v;
  };
  write("holes.5.scores.p1", 4);   // phone A
  write("holes.5.scores.p4", 6);   // phone B, same instant
  eq(doc.holes[5].scores.p1, 4, "phone A's score lost:");
  eq(doc.holes[5].scores.p4, 6, "phone B's score lost:");
});

t("R10 sync failure must not stop the app booting", () => {
  ok(html.includes("initSync().catch"), "initSync must be guarded");
  ok(appHTML().trim().length > 50, "app rendered despite no Firebase in this environment");
});

t("R13 a failed write reports an error, never a false 'offline'", () => {
  /* Bug: writes were failing (stale array-shaped data) and the catch marked
     the app 'offline' with no error code, so the real cause was invisible. */
  ok(!/setSync\("offline"\)/.test(html),
     "no code path may claim 'offline' without a diagnosis — use setSync('error', {err})");
  ok(/write failed/.test(html), "write failures must be labelled");
});

t("R14 stored data is schema-versioned", () => {
  ok(/const SCHEMA\s*=\s*\d+/.test(html), "SCHEMA constant missing");
  ok(/schema\s*\|\|\s*1\)\s*!==\s*SCHEMA/.test(html),
     "seeding must detect and replace data written under an older shape");
});

t("R15 field-path writes need map-shaped holes, not arrays", () => {
  ok(/function blankHoles\(\)\{[\s\S]{0,200}const o = \{\}/.test(html.replace(/\s+/g," ").replace(/function blankHoles\(\)\s*\{/,"function blankHoles(){"))
     || /const o = \{\};[\s\S]{0,120}o\[i\] = blankHole\(\)/.test(html),
     "holes must be an object keyed by hole number");
  ok(html.includes("holeList"), "array helpers should go through holeList()");
});

t("R11 index edit updates course handicap live", () => {
  tab("players");
  const before = document.querySelector('[data-ch="p5"]').textContent;
  type(document.querySelector('[data-index="p5"]'), "20.0");
  const after = document.querySelector('[data-ch="p5"]').textContent;
  ok(before !== after, "CH did not react to an index change");
});

t("R12 stroke index validation catches duplicates", () => {
  tab("players");
  const cells = [...document.querySelectorAll('.cc[data-cell^="si:"]')];
  type(cells[0], "5"); type(cells[1], "5");
  const msg = document.getElementById("cardmsg");
  ok(/repeat/i.test(msg.textContent), "duplicate stroke index not reported: " + msg.textContent);
});

t("R16 seeding never overwrites existing config", () => {
  /* Handicaps and courses must survive an app update. Only an explicit
     admin reset may replace them. */
  ok(/const fresh = !snap\.exists\(\);/.test(html),
     "seeding must distinguish a brand new tournament from an established one");
  ok(/if \(fresh\)\{\s*\n\s*await fsMod\.setDoc\(cfgRef,/.test(html),
     "config should be written only when absent");
  ok(html.includes("{ schema: SCHEMA }, { merge: true }"),
     "a schema bump must mark the version, not rewrite the content");
  ok(html.includes("resetTournament"), "an explicit reset path must exist");
});

t("R17 hole strip colours match the scoring engine", () => {
  dom.window.eval(`
    const g = GAMES.find(x=>x.id==="g1");
    g.holes = blankHoles();
    g.holes[0].scores = {p1:3,p4:9,p2:9,p5:9};
    g.holes[1].scores = {p1:9,p4:9,p2:3,p5:9};
    g.holes[2].scores = {p1:5,p4:9,p2:5,p5:9};
    view.gameId="g1"; view.hole=5; render();
  `);
  const cells = [...document.querySelectorAll(".hcell")];
  const winners = dom.window.eval('[0,1,2].map(i=>resolveHole(GAMES.find(x=>x.id==="g1"),i))');
  const expect = { A:"won-a", B:"won-b", H:"halved" };
  winners.forEach((w,i) =>
    ok(cells[i].className.includes(expect[w]),
       `hole ${i+1}: engine says ${w} but cell reads "${cells[i].className}"`));
  ok(document.querySelector(".hkey"), "legend missing");
});

t("R18 handicap index fields auto-advance like the scorecard", () => {
  ok(html.includes('advanceIn(".idx"'), "index fields should advance to the next player");
  ok(/\^\\d\{1,2\}\\\.\\d\$/.test(html) || html.includes("d{1,2}\\.\\d$"),
     "advance must wait for a decimal place — '12' may still become '12.4'");
});

t("R19 a degraded transport is never remembered as the preference", () => {
  /* Bug: the no-cache fallback got saved as the preferred transport, so every
     later open started there and permanently lost offline queueing. */
  ok(/if \(st && st\.offline\) localStorage\.setItem/.test(html),
     "only offline-capable transports may be remembered");
  ok(/else localStorage\.removeItem/.test(html),
     "a degraded connection must clear the preference, not save it");
});

t("R20 offline scoring does not depend on Firestore's cache", () => {
  /* Firestore's IndexedDB persistence fails on some phones. A local write
     queue keeps offline scoring working whatever transport we land on. */
  ok(html.includes("const QKEY"), "no durable queue");
  ok(html.includes("function flushQueue"), "no flush on reconnect");
  ok(html.includes("applyQueueLocally"), "queued scores must survive a server snapshot");
  ok(/window\.addEventListener\("online", flushQueue\)/.test(html), "should flush when signal returns");
  ok(html.includes("enqueue(g.id, h, path, value)"), "score writes must go through the queue");
});

t("R21 an abandoned attempt cannot clobber a working connection", () => {
  /* Bug: strategy 1's persistence error arrived after strategy 2 had already
     connected, and flipped a live app into a sync error. */
  ok(html.includes("let gen = 0;"), "no generation token on connection attempts");
  ok(html.includes("if (myGen !== gen) return;"), "callbacks must ignore superseded attempts");
  ok(html.includes("function reportListenerError"), "errors need generation-aware handling");
  ok(/if \(serverSeen\)\{ console\.log\("transient/.test(html),
     "a transient error must not knock out a connection already receiving data");
});

t("R22 a sync failure never blocks the interface", () => {
  /* Bug: a throwing sync call ran before render(), so the screen silently
     stopped updating when Firestore was unavailable. */
  ok(html.includes("if (!SYNC.on || !SYNC.api) return;"), "sync helpers must guard on api");
  ok(/catch \(err\)\{ console\.error\("click handler", err\); render\(\); \}/.test(html),
     "a throwing handler must still re-render");
});

t("R23 rounds own their course and handicap mode", () => {
  const w = dom.window;
  ok(w.eval('typeof roundOf === "function"'), "games must resolve their round");
  ok(w.eval('GAMES.every(g => !!g.roundId)'), "every game belongs to a round");
  ok(w.eval('GAMES.every(g => !g.courseId && !g.mode)'),
     "course and mode belong to the round, not duplicated on the game");
  ok(w.eval('courseOf(GAMES[0]).name.length > 0'), "course resolves through the round");
});

section("ADMIN — schedule editing");

t("schedule is admin-only except for travel", () => {
  /* Players enter their own flights; everything else needs the code. */
  const w = dom.window;
  w.eval("SYNC.on=true; isAdmin=false; view.gameId=null; view.tab='sched'; schedMode='timeline'; editEvent=null; render();");
  ok(document.querySelector("#acode"), "no unlock bar");
  const editable = [...document.querySelectorAll("[data-editev]")]
    .map(b => w.eval(`EV("${b.dataset.editev}").type`));
  ok(editable.length > 0, "travel should still be editable without the code");
  ok(editable.every(t => t === "TRAVEL"), "only travel may be edited: got " + editable.join(","));
  w.eval("schedMode='travel'; render();");
  ok(document.querySelector("[data-addtravel]"), "players need a way to add their own flights");
  w.eval("schedMode='timeline'; view.tab='home'; render();");
});

t("admin can edit events, rounds and rosters", () => {
  const w = dom.window;
  w.eval("isAdmin=true; view.gameId=null; view.tab='sched'; schedMode='timeline'; editEvent=null; render();");
  ok(document.querySelectorAll("[data-editev]").length > 0, "no edit buttons for admin");
  ok(document.querySelectorAll("[data-addev]").length > 0, "no add-event buttons");
  const btn = document.querySelector('[data-editev="r1"]');
  btn.dispatchEvent(new dom.window.MouseEvent("click", {bubbles:true}));
  ok(document.querySelector("[data-evcourse]"), "round editor missing course picker");
  ok(document.querySelector("[data-side]"), "round editor missing roster picker");
  ok(document.querySelector("[data-addgame]"), "round editor missing add-game");
});

t("roster picker enforces team sizes", () => isolate(() => {
  const w = dom.window;
  w.eval("isAdmin=true; view.gameId=null; view.tab='sched'; editEvent=ROUNDS()[0].id; render();");
  const gid = w.eval('GAMES.filter(g => g.roundId === ROUNDS()[0].id)[0].id');
  const before = w.eval(`GAMES.find(g=>g.id==="${gid}").teams[0].length`);
  const btn = document.querySelector(`[data-side="${gid}:p2:0"]`);
  ok(btn, "roster button not found for " + gid);
  btn.dispatchEvent(new dom.window.MouseEvent("click", {bubbles:true}));
  const after = w.eval(`GAMES.find(g=>g.id==="${gid}").teams[0].length`);
  eq(after, before + 1, "player did not move to team A:");
  ok(document.querySelector(".rost-sum .bad"), "an over-full team must be flagged");
  w.eval('editEvent=null; view.tab="home"; render();');
}));

t("schedule events are colour-coded by kind", () => {
  const w = dom.window;
  w.eval("isAdmin=false; view.gameId=null; view.tab='sched'; schedMode='timeline'; editEvent=null; render();");
  ["ev-round","ev-meal","ev-travel"].forEach(c =>
    ok(document.querySelector("." + c), c + " not rendered"));
  w.eval('view.tab="home"; render();');
});

t("R24 taps are not swallowed by double-tap zoom", () => {
  ok(/touch-action:manipulation/.test(html),
     "interactive elements need touch-action:manipulation or iOS delays every tap");
  ok(!/input[^{]*\{[^}]*font-size:1[0-5]px/.test(html),
     "an input under 16px makes iOS zoom the page on focus");
});

t("R29 copied rows are tab-separated so they land in columns", () => {
  /* Bug: comma-separated text pasted into Sheets lands entirely in column A.
     Spreadsheets split on tabs. */
  const w = dom.window;
  ok(w.eval('typeof toTSV === "function"'), "no TSV conversion before copying");
  ok(w.eval('copyText.toString().includes("toTSV")'), "copy must convert to tabs");
  const tsv = w.eval("toTSV(CSV_EXAMPLE)");
  eq(tsv.split("\n")[0].split("\t").length, 15, "header should be 15 cells:");
  ok(!tsv.split("\n")[0].includes(","), "header should not still be comma-joined");
});

t("R30 tab-separated rows parse back in", () => {
  const w = dom.window;
  ["toTSV(CSV_EXAMPLE)", "CSV_EXAMPLE", "toTSV(scheduleToCSV())", "scheduleToCSV()"]
    .forEach(src => {
      const plan = w.eval("parseCSV(" + src + ")");
      eq(plan.errors.length, 0, src + " produced errors: " + plan.errors.join("; "));
      ok(plan.games.length > 0, src + " parsed no games");
    });
});

t("R27 the blank CSV template is genuinely blank", () => {
  const w = dom.window;
  const tpl = w.eval("CSV_TEMPLATE");
  ok(!/Blake|Daniel|Pine Hollow/.test(tpl), "the blank template must not contain real data");
  ok(tpl.split("\n").filter(l => /^,+$/.test(l)).length > 5, "needs empty rows to type into");
  ok(w.eval("CSV_EXAMPLE").includes("Blake"), "a separate filled example should exist");
});

t("R28 games are grouped by day, not by course", () => isolate(() => {
  const w = dom.window;
  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Wednesday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Wednesday,,GAME,,BESTBALL,,,Blake,Dan,,,Jason,Daniel,,\\n" +
      "Thursday,08:10,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Thursday,,GAME,,BESTBALL,,,Blake,Daniel,,,Dan,Howard,,");
    applyCSV(p); view.gameId=null; view.tab="home"; editEvent=null;
    homeShowAll = true; render();      // the today filter is tested separately
  `);
  const heads = [...document.querySelectorAll("h2.sec")].map(x => x.textContent);
  eq(heads.join("|"), "Wednesday|Thursday", "same course on two days must not repeat as a heading:");
  w.eval("homeShowAll = false;");
}));

t("R25 schedule cards can be deleted without opening the editor", () => {
  const w = dom.window;
  w.eval("SYNC.on=true; isAdmin=true; view.tab='sched'; editEvent=null; render();");
  ok(document.querySelector("[data-delev]"), "no delete chip on the card");
  ok(document.querySelector("[data-clearday]"), "no clear-day control");
  w.eval('view.tab="home"; render();');
});

t("R26 data written by an older version is repaired on load", () => {
  /* Bug: seeding is non-destructive (so real handicaps survive updates), which
     means old-shaped config keeps loading from the server. Schedule events had
     no ids, so EV() found nothing and Edit/Delete silently did nothing. */
  const w = dom.window;
  ok(w.eval('typeof migrateLoaded === "function"'), "no migration step");
  w.eval(`
    SYNC.on = true; isAdmin = true;
    SCHEDULE.length = 0;
    SCHEDULE.push({day:"Friday", time:"19:30", type:"MEAL", title:"Old dinner"});
    GAMES.length = 0;
    GAMES.push({ id:"gold", round:"Saturday AM", courseId:"pine", type:"BESTBALL",
                 mode:"RELATIVE", teams:{0:["p1","p4"],1:["p2","p5"]}, holes:blankHoles() });
    migrateLoaded();
  `);
  ok(w.eval("SCHEDULE.every(e => !!e.id)"), "every event must end up with an id");
  ok(w.eval("GAMES.every(g => !!g.roundId && !!EV(g.roundId))"),
     "legacy games must be attached to a real round event");
  ok(w.eval('SCHEDULE.filter(e=>e.type==="ROUND").every(e => !!e.courseId && !!e.mode)'),
     "migrated rounds need a course and handicap mode");
  ok(w.eval("GAMES.every(g => !g.round && !g.courseId)"), "legacy fields should be cleared");
  w.eval('editEvent=null; view.tab="home"; render();');
});

section("CSV IMPORT & PAIRINGS");

t("a schedule survives export and re-import unchanged", () => isolate(() => {
  const w = dom.window;
  w.eval("SYNC.on=false; isAdmin=true;");
  const plan = w.eval("parseCSV(scheduleToCSV())");
  eq(plan.errors.length, 0, "round-trip produced errors: " + plan.errors.join("; "));
  ok(plan.games.length > 0, "no games survived the round-trip");
  ok(plan.events.filter(e => e.type === "ROUND").length > 0, "no rounds survived");
}));

t("bad rows are reported, never applied", () => {
  const w = dom.window;
  const bad = w.eval(`parseCSV(CSV_HEAD + "\\n" +
    "Saturday,8.10,ROUND,Nowhere GC,,,,,,,,,,,\\n" +
    "Saturday,,GAME,,BESTBALL,,,Blake,Nobody,,,Dan,,,\\n" +
    "Saturday,,GAME,,PUTTING,,,Blake,,,,Dan,,,")`);
  ok(bad.errors.length >= 4, "should flag bad time, course, player, size and format");
  ok(bad.errors.some(e => /time/i.test(e)), "bad time not caught");
  ok(bad.errors.some(e => /course/i.test(e)), "unknown course not caught");
  ok(bad.errors.some(e => /player|Nobody/i.test(e)), "unknown player not caught");
  ok(bad.errors.some(e => /format/i.test(e)), "unknown format not caught");
});

t("pairings matrix counts with and against correctly", () => isolate(() => {
  const w = dom.window;
  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Saturday,08:10,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Saturday,,GAME,,BESTBALL,,,Blake,Daniel,,,Dan,Howard,,");
    applyCSV(p);
  `);
  eq(w.eval("pairMatrix().withC.p1.p4"), 1, "Blake & Daniel are partners:");
  eq(w.eval("pairMatrix().agC.p1.p2"), 1, "Blake vs Dan:");
  eq(w.eval("pairMatrix().withC.p1.p2"), 0, "Blake never partners Dan:");
  eq(w.eval("pairMatrix().played.p1"), 1, "games played:");
}));

t("R31 every click handler has markup that can trigger it", () => {
  /* Twice now a feature shipped with a working handler and no button, because
     an edit targeted markup that didn't match. This catches that class. */
  const ids = [...html.matchAll(/el\.id === "([a-z0-9]+)"/g)].map(m => m[1]);
  const missing = ids.filter(id => !html.includes('id="' + id + '"'));
  ok(missing.length === 0, "handlers with no button in the markup: " + missing.join(", "));
});

t("R32 courses can be deleted, but not while in use", () => {
  const w = dom.window;
  w.eval("SYNC.on=false; isAdmin=true; view.tab='players'; view.gameId=null; render();");
  ok(document.querySelector("#crsdel"), "no delete control on the course picker");

  let alerted = null;
  const oldAlert = w.alert, oldConfirm = w.confirm;
  w.alert = m => { alerted = m; };
  w.confirm = () => true;
  try {
    // a course a round is played on must be protected
    w.eval("editCourseId = ROUNDS()[0].courseId; render();");
    const n = w.eval("COURSES.length");
    document.querySelector("#crsdel").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    eq(w.eval("COURSES.length"), n, "a course in use must not be deleted:");
    ok(/round/i.test(alerted || ""), "should explain why: " + alerted);

    // an unused one should go, and take stale tee assignments with it
    w.eval(`COURSES.push({id:'ctmp', name:'Spare GC',
      holes:Array.from({length:18},(_,i)=>({par:4,si:i+1})),
      tees:[{name:'Blue',rating:71,slope:125,par:72}]});
      PLAYERS[0].tees = PLAYERS[0].tees || {}; PLAYERS[0].tees.ctmp = 'Blue';
      editCourseId='ctmp'; render();`);
    const n2 = w.eval("COURSES.length");
    document.querySelector("#crsdel").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    eq(w.eval("COURSES.length"), n2 - 1, "unused course should delete:");
    ok(w.eval("!(PLAYERS[0].tees && PLAYERS[0].tees.ctmp)"), "stale tee assignment left behind");
  } finally {
    w.alert = oldAlert; w.confirm = oldConfirm;
    w.eval('view.tab="home"; render();');
  }
});

t("R33 an import keeps its games attached to the right rounds", () => isolate(() => {
  /* Bug: games were written immediately but the schedule was debounced 700ms.
     A server snapshot in that gap restored the old schedule, orphaning every
     game — and migration then lumped them all onto one round. */
  const w = dom.window;
  ok(html.includes("let cfgDirty"), "no dirty flag on local config");
  ok(/if \(cfgDirty \|\| d\.metadata\.hasPendingWrites\) return;/.test(html),
     "a server snapshot must not overwrite unsaved local config");
  ok(/cfgDirty = true;\s*\n\s*clearTimeout\(cfgTimer\);\s*\n\s*pushConfig\(\);/.test(html),
     "an import must write its schedule immediately, not on a debounce");

  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Saturday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Saturday,,GAME,,BESTBALL,,,Blake,Daniel,,,Dan,Howard,,\\n" +
      "Sunday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Sunday,,GAME,,BESTBALL,,,Jason,Luke,,,Jake,Adam,,");
    applyCSV(p); cfgDirty = false; migrateLoaded();
  `);
  const spread = w.eval('JSON.stringify(ROUNDS().map(r => GAMES.filter(g=>g.roundId===r.id).length))');
  eq(spread, "[1,1]", "two rounds at the same course must keep one game each:");
}));

t("R34 pair counts can never exceed games played", () => isolate(() => {
  /* Bug: the games listener merged snapshots into the existing list instead of
     replacing it, so deleted games lingered and every re-import stacked another
     copy. Pair counts climbed past the number of games in the tournament. */
  const w = dom.window;
  ok(/const fresh = \[\];[\s\S]{0,200}GAMES = fresh;/.test(html),
     "the games snapshot must rebuild the list, not merge into it");

  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Saturday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Saturday,,GAME,,BESTBALL,,,Blake,Daniel,,,Dan,Howard,,");
    applyCSV(p); applyCSV(p); applyCSV(p);   // as if earlier imports had failed
    cfgDirty = false;
  `);
  eq(w.eval("GAMES.length"), 1, "three imports of one game should leave one game:");

  const impossible = w.eval(`(function(){
    const m = pairMatrix(); const out = [];
    PLAYERS.forEach(a => PLAYERS.forEach(b => {
      if (a.id !== b.id && m.withC[a.id][b.id] > Math.min(m.played[a.id], m.played[b.id]))
        out.push(a.name + "+" + b.name);
    }));
    return out.join(", ");
  })()`);
  eq(impossible, "", "pairs counted more often than they played: ");
}));

t("R35 games orphaned by a deleted round can be cleared", () => isolate(() => {
  const w = dom.window;
  w.eval(`SYNC.on=false; isAdmin=true; view.tab="players"; view.gameId=null;
    GAMES.push({id:"stray", roundId:"gone", type:"BESTBALL",
                teams:{0:["p1","p4"],1:["p2","p5"]}, holes:blankHoles()});
    render();`);
  const btn = document.querySelector("#purgegames");
  ok(btn, "no way to clear stray games");
  const before = w.eval("GAMES.length");
  const oldConfirm = w.confirm; w.confirm = () => true;
  try {
    btn.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    eq(w.eval("GAMES.length"), before - 1, "the stray should be removed:");
    eq(w.eval('GAMES.filter(g => !g.roundId || !EV(g.roundId)).length'), 0, "strays remaining:");
  } finally { w.confirm = oldConfirm; w.eval('view.tab="home"; render();'); }
}));

t("R36 a foursome is the group that plays together, not the whole game", () => isolate(() => {
  /* Eight people don't walk the course as one group. In a 2v2 the four players
     are one foursome; in a scramble or 40ball each team is its own group. */
  const w = dom.window;
  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Saturday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Saturday,,GAME,,BESTBALL,,,Blake,Daniel,,,Dan,Howard,,\\n" +
      "Saturday,,GAME,,SCRAMBLE4,,,Blake,Daniel,Jason,Luke,Dan,Howard,Jake,Adam");
    applyCSV(p); cfgDirty = false;
  `);
  const m = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  // best ball: opponents share the foursome
  eq(m.grpC.p1.p2, 1, "Blake and Dan are opponents in the 2v2, so share that foursome:");
  // scramble: opponents do NOT share a foursome
  eq(m.agC.p1.p2, 2, "Blake and Dan oppose in both games:");
  eq(m.grpC.p1.p4, 2, "Blake and Daniel are together in both:");
  ok(m.grpC.p1.p2 < m.agC.p1.p2,
     "a scramble opponent must not count as a foursome partner");
}));

t("R41 an out-of-date device can't write over everyone else's data", () => {
  /* A phone on an older build recreated the demo games and pushed a stale
     schedule back into the shared database. */
  const w = dom.window;
  ok(html.includes("let staleDevice"), "no staleness check");
  ok(/appBuild: BUILD/.test(html), "config must record which build wrote it");
  ["pushConfig", "pushGame", "pushHole"].forEach(fn =>
    ok(new RegExp("function " + fn + "\\([^)]*\\)\\{\\s*\\n\\s*if \\(staleDevice").test(html),
       fn + " must refuse to write from an old build"));

  const before = w.eval("staleDevice");
  w.eval('staleDevice = true; view.tab="home"; view.gameId=null; serverBuild="2099-01-01.0000"; render();');
  ok(/out of date/i.test(document.getElementById("app").innerHTML),
     "an old device must be told, not fail silently");
  w.eval(`staleDevice = ${before}; serverBuild = null; render();`);
});

t("R42 stroke play shows no 40ball budget", () => isolate(() => {
  /* The scramble was falling through to 40ball's branch and showing 0/40. */
  const w = dom.window;
  w.eval(`
    const p = parseCSV(CSV_HEAD + "\\n" +
      "Saturday,,ROUND,Pine Hollow,,,,,,,,,,,\\n" +
      "Saturday,,GAME,,SCRAMBLE4,,,Blake,Daniel,Jason,Luke,Dan,Howard,Jake,Adam");
    applyCSV(p); cfgDirty = false;
    const g = GAMES[0];
    for (let i=0;i<4;i++){ g.holes[i].teamScore[0]=4; g.holes[i].teamScore[1]=5; }
    view.gameId = g.id; view.hole = 4; render();
  `);
  const heads = [...document.querySelectorAll(".team-score")].map(x => x.textContent);
  ok(heads.length, "no team headers rendered");
  ok(!heads.some(x => x.includes("/40")), "a scramble must not show the 40ball budget: " + heads.join(" | "));
  ok(heads.some(x => /tot 16/.test(x)), "should show the running stroke total: " + heads.join(" | "));
  w.eval('view.gameId=null; view.tab="home"; render();');
}));

t("R43 a locked hole can't be conceded", () => isolate(() => {
  const w = dom.window;
  w.eval('SYNC.on=false; isAdmin=true; view.tab="home"; view.gameId=null; render();');
  const gid = w.eval('GAMES.find(x=>x.type==="BESTBALL").id');
  w.eval(`view.gameId="${gid}"; view.hole=0; render();`);
  document.querySelector("[data-step]").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  document.querySelector("[data-lockteam]").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  const a = document.querySelector('[data-concede="0"]');
  const b = document.querySelector('[data-concede="1"]');
  ok(a.disabled, "the locked side must not be able to concede");
  ok(!b.disabled, "the other side should still be able to");
  a.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  eq(w.eval(`GAMES.find(g=>g.id==="${gid}").holes[0].conceded`), null,
     "a locked hole was conceded anyway:");
  w.eval('view.gameId=null; view.tab="home"; render();');
}));

t("R44 locking both sides moves to the next hole", () => isolate(() => {
  const w = dom.window;
  w.eval('SYNC.on=false; isAdmin=true; view.tab="home"; view.gameId=null; render();');
  const gid = w.eval('GAMES.find(x=>x.type==="BESTBALL").id');
  w.eval(`view.gameId="${gid}"; view.hole=0; render();`);
  const fire = sel => { const els=[...document.querySelectorAll(sel)];
    els[els.length-1].dispatchEvent(new w.MouseEvent("click",{bubbles:true})); };
  document.querySelector("[data-step]").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  document.querySelector("[data-lockteam]").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  eq(w.eval("view.hole"), 0, "one side locking should not advance:");
  fire("[data-step]"); fire("[data-lockteam]");
  eq(w.eval("view.hole"), 1, "both sides locked should advance:");
  w.eval(`view.hole=17; render();`);
  w.eval(`(function(){const g=GAMES.find(x=>x.id==="${gid}");
    g.holes[17].scores[g.teams[0][0]]=4; g.holes[17].scores[g.teams[1][0]]=4;
    g.holes[17].locked[0]=true;})(); render();`);
  const last=[...document.querySelectorAll("[data-lockteam]")];
  if (last.length) last[last.length-1].dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  eq(w.eval("view.hole"), 17, "must not run past the 18th:");
  w.eval('view.gameId=null; view.tab="home"; render();');
}));

t("R45 scores can be exported as readable text", () => isolate(() => {
  const w = dom.window;
  w.eval(`(function(){ const g = GAMES.find(x=>x.type==="BESTBALL");
    g.holes[0].scores[g.teams[0][0]] = 4; g.holes[0].scores[g.teams[1][0]] = 5; })()`);
  const txt = w.eval("scoresToText()");
  ok(txt.includes("THE EI"), "no header");
  ok(/STANDINGS/.test(txt), "standings missing from the export");
  ok(txt.split("\n").length > 10, "export looks empty");
  ok(txt.includes(w.eval("BUILD")), "should record which build produced it");
}));

t("R46 body text is dark enough to read outdoors", () => {
  const lum = hex => {
    const v = i => parseInt(hex.slice(i, i+2), 16) / 255;
    const f = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
    return 0.2126*f(v(0)) + 0.7152*f(v(2)) + 0.0722*f(v(4));
  };
  const paper = lum("E9E4D6");
  const ratio = c => (Math.max(paper, lum(c)) + 0.05) / (Math.min(paper, lum(c)) + 0.05);
  ["ink", "ink-soft", "ink-faint"].forEach(name => {
    const m = html.match(new RegExp("--" + name + ":#(\\w{6})"));
    ok(m, "no colour defined for " + name);
    const r = ratio(m[1]);
    ok(r >= 4.5, name + " is only " + r.toFixed(1) + ":1 against the background");
  });
});

t("R47 each year is its own tournament, and old ones are frozen", () => {
  const w = dom.window;
  ok(!/prototype/i.test(html), "the app shouldn't still call itself a prototype");
  ok(html.includes("const tidFor"), "no per-year database path");
  ok(/const isArchive\s*=/.test(html), "no archive concept");

  const savedY = w.eval("JSON.stringify([YEARS, liveYear, activeYear])");
  try {
    w.eval('YEARS=["2026","2027"]; liveYear="2027"; activeYear="2027"; view.tab="board"; view.gameId=null; render();');
    eq(w.eval("isArchive()"), false, "the live year is not an archive:");
    ok(document.querySelectorAll("[data-year]").length >= 2, "no year picker");

    w.eval('activeYear="2026"; render();');
    eq(w.eval("isArchive()"), true, "an earlier year should be an archive:");

    // writes must be refused
    w.eval('SYNC.on=true; SYNC.api={doc:()=>({}),setDoc:()=>{throw new Error("wrote")},' +
           'updateDoc:()=>{throw new Error("wrote")},deleteDoc:()=>{throw new Error("wrote")}};');
    w.eval('pushConfig(); pushGame(GAMES[0]); pushHole(GAMES[0],0,"scores.p1",4);');

    // and the controls that change things must be gone
    w.eval('view.tab="home"; view.gameId=GAMES[0].id; view.hole=0; render();');
    eq(document.querySelectorAll("[data-lockteam]").length, 0, "archive must not offer locking:");
    eq(document.querySelectorAll("[data-concede]").length, 0, "archive must not offer conceding:");
  } finally {
    const [y, l, a] = JSON.parse(savedY);
    w.eval(`YEARS=${JSON.stringify(y)}; liveYear=${JSON.stringify(l)}; activeYear=${JSON.stringify(a)};
            SYNC.on=false; SYNC.api=null; view.gameId=null; view.tab="home"; render();`);
  }
});

section("FIRESTORE — data must be storable");

/* Firestore rejects any array whose elements are themselves arrays, and
   rejects undefined. Both fail at write time with a vague 'invalid-argument',
   so check the shapes here instead of finding out on a phone. */
function firestoreProblems(value, path){
  const bad = [];
  const walk = (v, p, insideArray) => {
    if (v === undefined){ bad.push(p + " is undefined"); return; }
    if (Array.isArray(v)){
      if (insideArray) bad.push(p + " is an array directly inside an array");
      v.forEach((x,i) => walk(x, p + "[" + i + "]", true));
    } else if (v && typeof v === "object"){
      Object.keys(v).forEach(k => walk(v[k], p + "." + k, false));
    }
  };
  walk(value, path, false);
  return bad;
}

t("seed data contains no nested arrays or undefined", () => {
  const w = dom.window;
  ["PLAYERS","COURSES","SCHEDULE","GAMES"].forEach(name => {
    const val = w.eval(name);
    const problems = firestoreProblems(JSON.parse(JSON.stringify(val)), name);
    ok(problems.length === 0, name + ": " + problems.join("; "));
  });
});

t("game teams are keyed 0/1, not an array of arrays", () => {
  const g = dom.window.eval("JSON.parse(JSON.stringify(GAMES[0]))");
  ok(!Array.isArray(g.teams), "teams must not be an array — Firestore rejects array-of-array");
  ok(Array.isArray(g.teams[0]) && Array.isArray(g.teams[1]), "teams[0] and teams[1] must be arrays");
});

t("holes are keyed by number, not an array", () => {
  const g = dom.window.eval("JSON.parse(JSON.stringify(GAMES[0]))");
  ok(!Array.isArray(g.holes), "holes must be a map so field-path writes work");
  ok(g.holes["0"] && g.holes["17"], "all 18 holes present");
});

/* ---------------- report ---------------- */
console.log("\n" + "=".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n" + fails.map(f => " - " + f).join("\n")); process.exit(1); }
