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
/* A couple of things can only be tested by waiting — a fetch, a promise. The
   plain runner above would count those as passed before they finished, so
   they queue up and run at the end, after everything synchronous. */
const deferred = [];
function ta(label, fn){ deferred.push([label, fn]); }
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
/* Long screens are now collapsible sections, one open at a time, so a test
   that wants a control has to open the section holding it first. */
const openSection = key => {
  const [grp, name] = key.split(":");
  if (dom.window.eval(`openPanel[${JSON.stringify(grp)}]`) === name) return;
  const b = document.querySelector(`[data-panel="${key}"]`);
  ok(b, "no section called " + key);
  click(b);
};
const gameBtn = id => [...document.querySelectorAll("[data-game]")].find(b => b.dataset.game === id);

/* What the tournament looked like before any test touched it. A test that
   replaces the schedule or the game list and forgets to put it back leaves
   every later test running against a stub — which is how a green suite missed
   deletions coming back. The last test compares against this. */
const WORLD0 = dom.window.eval("JSON.stringify({g:GAMES.length, s:SCHEDULE.length, d:DAYS.length, c:COURSES.length, p:PLAYERS.length})");
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
/* The picker is a dropdown rather than a row of buttons: a button each stops
   working once there are more than three or four courses. */
t("three courses offered", () => {
  const btn = document.querySelector('[data-pick="crs"]');
  ok(btn, "no course picker");
  click(btn);
  eq(document.querySelectorAll("[data-pickset]").length, 3);
  click(document.querySelector('[data-pick="crs"]'));   // close it again
});
["marsh","stone","pine"].forEach(cid => t("switch: " + cid, () => {
  click(document.querySelector('[data-pick="crs"]'));
  click(document.querySelector(`[data-pickset="crs:${cid}"]`));
  eq(dom.window.eval("editCourseId"), cid, "the picker didn't switch course:");
  eq(document.querySelectorAll("[data-pickset]").length, 0, "the list should close on a pick:");
  openSection("f:card");
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
  openSection("f:hcp");
  type(document.querySelector('[data-index="p5"]'), "20.0");
  openSection("f:who");
  const after = document.querySelector('[data-ch="p5"]').textContent;
  openSection("f:hcp");
  type(document.querySelector('[data-index="p5"]'), "4.0");
  openSection("f:who");
  const other = document.querySelector('[data-ch="p5"]').textContent;
  ok(after !== other, "CH did not react to an index change");
});

t("R12 stroke index validation catches duplicates", () => {
  tab("players");
  openSection("f:card");
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
  ok(document.querySelectorAll("[data-addround], [data-addev]").length > 0,
     "no way to add anything to a day");
  const btn = document.querySelector('[data-editev="r1"]');
  btn.dispatchEvent(new dom.window.MouseEvent("click", {bubbles:true}));
  ok(document.querySelector('[data-pick="ev"]'), "round editor missing course picker");
  /* Games are a section you open, not a form to scroll past: a round is a real
     thing on the schedule with or without anyone competing in it. */
  openSection("e:games");
  ok(document.querySelector("[data-side]"), "round editor missing roster picker");
  ok(document.querySelector("[data-addgame]"), "round editor missing add-game");
});

t("roster picker enforces team sizes", () => isolate(() => {
  const w = dom.window;
  w.eval("isAdmin=true; view.gameId=null; view.tab='sched'; editEvent=ROUNDS()[0].id; render();");
  const gid = w.eval('GAMES.filter(g => g.roundId === ROUNDS()[0].id)[0].id');
  openSection("e:games");
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
  /* Width is derived now — four player columns per side, four sides — so this
     checks against the app's own count rather than a number frozen in a test. */
  eq(tsv.split("\n")[0].split("\t").length, w.eval("CSV_WIDTH"),
     "header should be as wide as the template says:");
  eq(w.eval("CSV_WIDTH"), 23, "seven description columns plus four sides of four:");
  tsv.split("\n").filter(l => l.length).forEach((line, i) =>
    eq(line.split("\t").length, w.eval("CSV_WIDTH"),
       "every row must be the same width, row " + (i+1) + ":"));
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

/* Wrapped: this one replaces the whole schedule and game list. Left
   unisolated it handed every later test a one-game tournament, which is
   exactly how deletion bugs got through a green suite. */
t("R26 data written by an older version is repaired on load", () => isolate(() => {
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
  w.eval('editEvent=null; view.tab="home"; SYNC.on=false; render();');
}));

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
  openSection("f:card");
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
  ok(/const fresh = \[\];[\s\S]{0,900}GAMES = fresh;/.test(html),
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
  openSection("f:danger");
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

t("R57 the built-in history matches the source it came from", () => {
  const w = dom.window;
  /* These five years are typed into the app from Blake's groupings sheet, so
     the thing worth proving is that they still add up to the totals that sheet
     carried: Blake 13-7-1 over 21 games, and so on down to Gabe. A typo here
     would be invisible on screen and wrong forever. */
  const seed = JSON.parse(w.eval("JSON.stringify(HISTORY_SEED)"));
  eq(Object.keys(seed).sort().join(","), "2021,2022,2023,2024,2025", "years present:");

  const saved = w.eval("JSON.stringify(HIST.years)");
  try {
    w.eval(`HIST.years = {}; Object.keys(HISTORY_SEED).forEach(y =>
      HIST.years[y] = { source:"recorded", rows: HISTORY_SEED[y].rows });`);
    const all = JSON.parse(w.eval("JSON.stringify(allTime())"));
    const sheet = {
      Blake:"13-7-1-21", Dan:"12-8-1-21", Adam:"11-10-0-21", Jason:"10-11-0-21",
      Daniel:"8-12-1-21", Luke:"8-9-2-19", Howard:"8-8-3-19", Jake:"5-9-0-14",
      Gabe:"2-3-2-7"
    };
    eq(all.length, Object.keys(sheet).length, "every player in the sheet should appear:");
    all.forEach(r => {
      eq([r.w,r.l,r.t,r.gp].join("-"), sheet[r.name], r.name + " doesn't match the sheet:");
      eq(r.gp, r.w + r.l + r.t, r.name + "'s games played should be W+L+T:");
    });

    // each row's own games played must also be self-consistent
    Object.keys(seed).forEach(y => seed[y].rows.forEach(r =>
      eq(r.gp, r.w + r.l + r.t, y + " " + r.name + ": gp should be W+L+T:")));

    // the winners that fall out of those numbers, ties included
    eq(w.eval('JSON.stringify(yearWinners(HISTORY_SEED["2022"].rows))'), '["Blake"]',
       "2022 should be Blake outright:");
    eq(w.eval('JSON.stringify(yearWinners(HISTORY_SEED["2024"].rows))'), '["Daniel"]',
       "2024 should be Daniel outright:");
    eq(w.eval('JSON.stringify(yearWinners(HISTORY_SEED["2025"].rows))'), '["Adam"]',
       "2025 should be Adam outright:");
    eq(w.eval('yearWinners(HISTORY_SEED["2021"].rows).length'), 4, "2021 was a four-way tie:");
    eq(w.eval('yearWinners(HISTORY_SEED["2023"].rows).length'), 3, "2023 was a three-way tie:");
  } finally {
    w.eval(`HIST.years = JSON.parse(${JSON.stringify(saved)}); render();`);
  }
});

t("R58 the built-in history is only ever written once", () => {
  /* The seed must never overwrite a database that already has history — a
     year corrected in the app would come back wrong on the next person's
     first load. The write has to be inside the branch that runs only when the
     document is absent. */
  const m = /if \(!hs\.exists\(\)\)\{([\s\S]{0,400}?)\n      \}/.exec(html);
  ok(m, "the seed write isn't guarded by a check that history is absent");
  ok(/setDoc/.test(m[1]), "the guarded branch should be the one that writes the seed");
  const writes = (html.match(/tournaments", "_history"/g) || []).length;
  ok(writes >= 2, "expected the history document to be read and written");
  ok(!/HISTORY_SEED/.test(html.split("async function saveRecordedYear")[1] || ""),
     "saving a year by hand must not consult the seed");
});

t("R60 the chosen course is readable, whatever the phone does with form controls", () => isolate(() => {
  const w = dom.window;
  /* The native picker rendered as an empty box on the phone: options present,
     a course resolved, nothing visible in it. Twice — once with
     appearance:none, once with the system control. So the picker is drawn
     with the app's own buttons, and the name is printed in the heading too. */
  ok(!/<select class="sel"/.test(html),
     "the course picker must not be a native <select> — its text rendered blank on the phone");

  tab("players");
  w.eval("pickOpen = null; render();");
  const name = w.eval("C(editCourseId).name");
  ok(appHTML().includes(name), "the current course name should be on the page as text");
  const btn = document.querySelector('[data-pick="crs"]');
  ok(btn, "no course picker");
  ok(btn.textContent.includes(name),
     "the picker should name the course the rest of the screen is showing");

  click(btn);
  const opts = [...document.querySelectorAll("[data-pickset]")];
  eq(opts.length, w.eval("COURSES.length"), "every course should be listed:");
  ok(opts.every(o => o.textContent.trim().length), "every option must have visible text");
  ok(opts.filter(o => o.className === "on").length === 1, "exactly one option should be marked current");
  click(document.querySelector('[data-pick="crs"]'));

  // same in the round editor
  w.eval(`isAdmin = true; pickOpen = null;
    SCHEDULE.push({ id:"rNamed", day:DAYS[0], type:"ROUND", title:"", courseId: COURSES[1].id });
    openEvent("rNamed", false); view.tab = "sched"; render();`);
  ok(appHTML().includes(w.eval("COURSES[1].name")),
     "the round editor should name the course in text, not only inside a control");
  w.eval("closeEvent(true)");
}));

t("R61 the old \"New event\" placeholder is cleared off existing data", () => isolate(() => {
  const w = dom.window;
  /* Written by a build that used it as a placeholder, it stuck as a real
     title — and on a round it displaced the course name. */
  w.eval(`SCHEDULE.push({ id:"rOld", day:DAYS[0], type:"ROUND", title:"New event",
                          courseId: COURSES[0].id });
          SCHEDULE.push({ id:"eOld", day:DAYS[0], type:"OTHER", title:"New event" });
          SCHEDULE.push({ id:"eKeep", day:DAYS[0], type:"OTHER", title:"New event planning" });
          migrateLoaded();`);
  eq(w.eval('EV("rOld").title'), "", "the placeholder should be cleared off a round:");
  eq(w.eval('eventName(EV("rOld"))'), w.eval("COURSES[0].name"),
     "the round should fall back to its course name:");
  eq(w.eval('eventName(EV("eOld"))'), "Untitled event", "a plain event should say it's untitled:");
  eq(w.eval('EV("eKeep").title'), "New event planning",
     "a real title that merely starts with those words must be left alone:");
}));

t("R59 the app survives having no courses at all", () => isolate(() => {
  const w = dom.window;
  /* C() used to fall back to COURSES[0], which is no help when the list is
     empty: every caller does co.name or co.holes[h].par, so a tournament with
     its courses not yet added took the whole screen down. */
  const saved = w.eval("JSON.stringify(COURSES)");
  try {
    w.eval("COURSES.length = 0; editCourseId = null;");
    w.eval('view.gameId = GAMES[0].id; view.hole = 0; render();');
    ok(appHTML().length > 0, "the scorecard should still render with no courses");
    w.eval('view.gameId = null; view.tab = "players"; render();');
    ok(appHTML().includes("No courses yet"), "the Field tab should say there are none");
    w.eval('isAdmin = true; SCHEDULE.push({id:"rEmpty",day:DAYS[0],type:"ROUND",title:""});' +
           'openEvent("rEmpty", false); view.tab = "sched"; render();');
    ok(!document.getElementById("evcourse"), "no picker should be offered with nothing to pick");
    ok(appHTML().includes("No courses yet"), "the round editor should say where to add one");
    w.eval("closeEvent(true)");
  } finally {
    w.eval(`COURSES.length = 0; JSON.parse(${JSON.stringify(saved)}).forEach(c => COURSES.push(c));
            editCourseId = COURSES[0].id; view.gameId = null; view.tab = "home"; render();`);
  }
}));

t("R55 a round with no course says so, instead of showing one it hasn't got", () => isolate(() => {
  const w = dom.window;
  /* Two failures in one: a <select> with nothing selected still displays its
     first option, so an unset round looked as though it had a course — and
     picking the one already shown fires no change event, so nothing happened.
     The picker is drawn in the app now, which also fixed its text rendering
     as blank on the phone. */
  w.eval(`isAdmin = true; pickOpen = null;
    SCHEDULE.push({ id:"rNoCourse", day:DAYS[0], time:null, type:"ROUND", title:"" });
    openEvent("rNoCourse", false); view.tab = "sched"; view.gameId = null; render();`);
  const btn = document.querySelector('[data-pick="ev"]');
  ok(btn, "no course picker in the round editor");
  ok(/choose a course/i.test(btn.textContent), "an unset round must say so, not name a course");
  ok(btn.querySelector(".selbtn-v.none"), "the empty state should be marked as empty");

  // the value is readable as text, which a <select> was not
  click(btn);
  const opts = [...document.querySelectorAll("[data-pickset]")];
  eq(opts.length, w.eval("COURSES.length"), "every course should be offered:");
  ok(opts.every(o => o.textContent.trim().length), "every option needs visible text");

  click(document.querySelector(`[data-pickset="ev:${w.eval("COURSES[1].id")}"]`));
  eq(w.eval('EV("rNoCourse").courseId'), w.eval("COURSES[1].id"), "the choice didn't stick:");
  eq(w.eval('eventName(EV("rNoCourse"))'), w.eval("COURSES[1].name"),
     "the round should take the course's name:");
  ok(/COURSES\[1\]/.test("x") || document.querySelector('[data-pick="ev"]')
       .textContent.includes(w.eval("COURSES[1].name")),
     "the picker should now show the chosen course");
}));

t("R62 Games and Schedule agree on what's on a given day", () => isolate(() => {
  const w = dom.window;
  /* The Games tab filtered out rounds with no games, which was harmless until
     gameless rounds became a supported thing — then Schedule showed two
     Thursday rounds and Games showed one. */
  w.eval(`isAdmin = true; homeShowAll = true; view.gameId = null; editEvent = null;
    SCHEDULE.push({ id:"rEmptyDay", day:DAYS[0], time:"08:15", type:"ROUND",
                    title:"", courseId: COURSES[2].id });
    view.tab = "home"; render();`);
  const onGames = appHTML();
  ok(onGames.includes(w.eval("COURSES[2].name")),
     "a round with no games should still appear on the Games tab");
  ok(/No games set/.test(onGames), "it should say why it has no cards under it");

  // both tabs should name the same rounds for that day
  const day = w.eval("DAYS[0]");
  const roundsThatDay = JSON.parse(w.eval(
    `JSON.stringify(ROUNDS().filter(r => r.day === ${JSON.stringify(day)}).map(r => eventName(r)))`));
  roundsThatDay.forEach(n =>
    ok(onGames.includes(n), "Games tab is missing a round the Schedule has: " + n));

  w.eval('view.tab = "sched"; schedMode = "timeline"; render();');
  const onSched = appHTML();
  roundsThatDay.forEach(n =>
    ok(onSched.includes(n), "Schedule is missing a round the Games tab has: " + n));
}));

t("R56 a round is complete without any games in it", () => isolate(() => {
  const w = dom.window;
  w.eval(`isAdmin = true;
    SCHEDULE.push({ id:"rSolo", day:DAYS[0], time:"08:15", type:"ROUND",
                    title:"", courseId: COURSES[0].id });
    view.tab = "sched"; view.gameId = null; editEvent = null; render();`);
  eq(w.eval('GAMES.filter(g => g.roundId === "rSolo").length'), 0, "it should start with no games:");
  // it appears on the schedule, named by its course, and nothing complains
  ok(appHTML().includes(w.eval("COURSES[0].name")), "a gameless round should still be listed");
  w.eval('openEvent("rSolo", false); render();');
  ok(document.getElementById("evdone"), "the editor should offer Done with no games added");
  ok(!document.querySelector("[data-side]"), "the roster picker should not be forced open");
  w.eval("closeEvent(true)");
  ok(!!w.eval('EV("rSolo")'), "the round should survive being saved with no games:");
}));

t("R52 backing out of an editor undoes what was typed", () => isolate(() => {
  const w = dom.window;
  tab("sched");

  // an existing event: Cancel puts it back
  const id = w.eval('SCHEDULE.find(e => e.type === "ROUND").id');
  const before = w.eval(`JSON.stringify(EV(${JSON.stringify(id)}))`);
  w.eval(`isAdmin = true; openEvent(${JSON.stringify(id)}, false); render();`);
  ok(document.getElementById("back").style.display !== "none",
     "Back should be offered while an editor is open");
  w.eval(`EV(${JSON.stringify(id)}).notes = "typed by mistake"; EV(${JSON.stringify(id)}).time = "23:59";`);
  eq(w.eval("editorDirty()"), true, "the editor should notice a change:");
  w.eval("closeEvent(false)");
  eq(w.eval(`JSON.stringify(EV(${JSON.stringify(id)}))`), before, "Cancel didn't restore the event:");
  eq(w.eval("editEvent"), null, "the editor should have closed:");

  // a brand-new event: backing out removes it entirely
  const n0 = w.eval("SCHEDULE.length");
  w.eval(`(function(){
    const nid = "etest1";
    SCHEDULE.push({ id:nid, day:DAYS[0], time:null, type:"OTHER", title:"" });
    openEvent(nid, true); render();
  })()`);
  eq(w.eval("SCHEDULE.length"), n0 + 1, "the new event should exist while being edited:");
  w.eval("closeEvent(false)");
  eq(w.eval("SCHEDULE.length"), n0, "backing out of a new event should remove it:");

  // Done keeps it
  w.eval(`(function(){
    SCHEDULE.push({ id:"etest2", day:DAYS[0], time:null, type:"OTHER", title:"Dinner" });
    openEvent("etest2", true); render();
  })()`);
  w.eval("closeEvent(true)");
  eq(w.eval('!!EV("etest2")'), true, "Done should keep a new event:");
}));

t("R53 an event with no title is never called \"New event\"", () => {
  const w = dom.window;
  ok(!/title\s*:\s*["']New event["']/.test(html),
     'an event is still being created with the placeholder title "New event"');
  eq(w.eval('eventName({ type:"OTHER", title:"" })'), "Untitled event",
     "an untitled event should say so:");
  eq(w.eval('eventName({ type:"MEAL", title:"" })'), "Meal", "a meal should name itself:");
  // a round is named by its course, with or without a title
  const cid = w.eval("COURSES[0].id"), cname = w.eval("COURSES[0].name");
  eq(w.eval(`eventName({ type:"ROUND", title:"", courseId:${JSON.stringify(cid)} })`), cname,
     "a round should take its course's name:");
});

t("R54 past years can be pasted in one block", () => {
  const w = dom.window;
  const text = [
    "2021", "Blake 2 1", "Dan 2 1", "Gabe 2 1", "Adam 2 1",
    "Howard 1 2", "Luke 1 2", "Jason 1 2", "Daniel 1 2",
    "", "2022", "Blake, 3, 0, 1", "Howard\t1\t0\t3"
  ].join("\n");
  const got = JSON.parse(w.eval(`JSON.stringify(parseHistory(${JSON.stringify(text)}))`));
  eq(got.errs.length, 0, "clean input should produce no errors: " + got.errs.join("; "));
  eq(Object.keys(got.years).join(","), "2021,2022", "both years should be read:");
  eq(got.years["2021"].length, 8, "2021 should have eight players:");

  // commas and tabs are as valid as spaces, and ties are optional
  const b22 = got.years["2022"].find(r => r.name === "Blake");
  eq(JSON.stringify(b22), '{"name":"Blake","w":3,"l":0,"t":1,"gp":4}', "comma-separated row:");
  const h22 = got.years["2022"].find(r => r.name === "Howard");
  eq(h22.t, 3, "tab-separated row with ties:");
  eq(got.years["2021"][0].t, 0, "a missing tie column counts as none:");

  // the winner that falls out of the real 2022 numbers
  eq(w.eval(`JSON.stringify(yearWinners(parseHistory(${JSON.stringify(text)}).years["2022"]))`),
     '["Blake"]', "3-0-1 should win 2022:");

  // junk is reported rather than silently dropped
  const bad = JSON.parse(w.eval(
    `JSON.stringify(parseHistory("2021\\nBlake 2 1\\nthis is not a row"))`));
  eq(bad.errs.length, 1, "an unreadable line should be reported:");
  eq(bad.years["2021"].length, 1, "the readable rows should still come through:");

  // a row before any year is an error, not a guess
  const noyear = JSON.parse(w.eval(`JSON.stringify(parseHistory("Blake 2 1"))`));
  eq(noyear.errs.length, 1, "a row with no year above it should be reported:");
  eq(Object.keys(noyear.years).length, 0, "and nothing should be recorded:");
});

t("R50 all-time records sum across years, and a year is won on percentage", () => {
  const w = dom.window;
  const saved = w.eval("JSON.stringify(HIST.years)");
  try {
    w.eval(`HIST.years = {
      "2024": { source:"recorded", rows:[
        {name:"Blake", w:3,l:1,t:0,gp:4},
        {name:"Dan",   w:2,l:2,t:0,gp:4},
        {name:"Howard",w:4,l:0,t:0,gp:4}]},
      "2025": { source:"played", rows:[
        {name:"Blake", w:2,l:1,t:1,gp:4},
        {name:"Howard",w:1,l:3,t:0,gp:4}]}
    };`);

    eq(w.eval('JSON.stringify(yearWinners(HIST.years["2024"].rows))'), '["Howard"]',
       "4-0 should win 2024:");
    eq(w.eval('JSON.stringify(yearWinners(HIST.years["2025"].rows))'), '["Blake"]',
       "2-1-1 should win 2025:");

    const all = JSON.parse(w.eval("JSON.stringify(allTime())"));
    const blake = all.find(r => r.name === "Blake");
    eq(blake.w, 5, "Blake's wins should add up across both years:");
    eq(blake.gp, 8, "Blake's games played should add up:");
    eq(blake.t, 1, "ties should carry:");
    eq(blake.pct, 5.5/8, "a tie is half a win over games played:");
    eq(blake.years, 2, "Blake played both years:");
    eq(blake.wins, 1, "Blake won one of them:");
    eq(all.find(r => r.name === "Dan").years, 1, "Dan played one year:");
    eq(all[0].name, "Blake", "equal titles should break on percentage, so Blake leads:");

    /* The rule that matters, and the reason it isn't total points: Howard
       plays fewer games (he sits out the 3v3), wins all of them, and must
       still take the year from someone with more points. */
    w.eval(`HIST.years = { "2030": { source:"recorded", rows:[
      {name:"Howard", w:4,l:0,t:0,gp:4},
      {name:"Grinder", w:5,l:3,t:0,gp:8}]}};`);
    eq(w.eval('JSON.stringify(yearWinners(HIST.years["2030"].rows))'), '["Howard"]',
       "fewer games but a perfect record should win:");

    // a genuine dead heat names both
    w.eval(`HIST.years = { "2031": { source:"recorded", rows:[
      {name:"A", w:2,l:2,t:0,gp:4},
      {name:"B", w:1,l:1,t:0,gp:2}]}};`);
    eq(w.eval('JSON.stringify(yearWinners(HIST.years["2031"].rows))'), '["A","B"]',
       "an exact tie should name both:");

    // nobody has played: no winner, and nothing throws
    eq(w.eval('JSON.stringify(yearWinners([{name:"A",w:0,l:0,t:0,gp:0}]))'), "[]",
       "an unplayed year has no winner:");
    eq(w.eval("JSON.stringify(yearWinners([]))"), "[]", "an empty year has no winner:");
  } finally {
    w.eval(`HIST.years = ${JSON.stringify(saved)} && JSON.parse(${JSON.stringify(saved)}); render();`);
  }
});

t("R51 reading an old year leaves this year's data untouched", () => {
  const w = dom.window;
  /* History computes each year against that year's own players, courses and
     tees — a course handicap worked out against the wrong tees would hand the
     wrong man the trophy. The globals get swapped to do it, so the thing to
     prove is that they always come back. */
  const before = w.eval("JSON.stringify([PLAYERS, COURSES, GAMES, SCHEDULE])");
  w.eval(`withYearData(
    { players:[{id:"x1",name:"Ghost",index:0,tees:{}}], courses:[], schedule:[] },
    [], () => standings());`);
  eq(w.eval("JSON.stringify([PLAYERS, COURSES, GAMES, SCHEDULE])"), before,
     "the swap leaked:");

  // and it must restore even when the work throws
  let threw = false;
  try { w.eval(`withYearData({ players:[] }, [], () => { throw new Error("boom"); });`); }
  catch(e){ threw = true; }
  ok(threw, "the error should surface rather than being swallowed");
  eq(w.eval("JSON.stringify([PLAYERS, COURSES, GAMES, SCHEDULE])"), before,
     "the swap leaked after an error:");
});

/* Three functions were once defined twice, 105 identical lines apart. Nothing
   misbehaved — the later definition wins and said the same thing — but it is
   exactly how an edit comes to be silently overridden, which has already cost
   us three debugging sessions. One definition each, or fail. */
t("R49 no function is defined twice", () => {
  const seen = {};
  const dupes = [];
  html.split("\n").forEach((line, i) => {
    const m = /^function ([A-Za-z0-9_$]+)\s*\(/.exec(line);
    if (!m) return;
    if (seen[m[1]]) dupes.push(m[1] + " (lines " + seen[m[1]] + " and " + (i+1) + ")");
    else seen[m[1]] = i + 1;
  });
  ok(dupes.length === 0, "defined more than once, so the later one silently wins: "
     + dupes.join("; "));
});

/* The version check reads the build stamp back out of the published page.
   That only works while the stamp is the FIRST thing in the file matching the
   pattern — and the pattern now appears twice, once as the declaration and
   once as the regex that looks for it. Get that order wrong and every phone
   is told it's out of date, or never told at all. */
ta("R48 a newer published build is detected and offered", async () => {
  const w = dom.window;

  // 1. the stamp can be read back out of the real page, and is the right one
  const found = /const BUILD\s*=\s*"([^"]+)"/.exec(html);
  ok(found, "no build stamp could be parsed out of the page");
  eq(found[1], w.eval("BUILD"), "the first stamp in the file isn't the running build:");
  ok(/^\d{4}-\d{2}-\d{2}\.\d{4}$/.test(found[1]), "build stamp isn't YYYY-MM-DD.HHMM: " + found[1]);

  // 2. comparison is a date comparison, and junk never counts as newer
  eq(w.eval('buildIsNewer("2026-10-05.2030","2026-09-05.0138")'), true,  "later date is newer:");
  eq(w.eval('buildIsNewer("2026-09-05.0138","2026-10-05.2030")'), false, "earlier date is not newer:");
  eq(w.eval('buildIsNewer("2026-10-05.0138","2026-10-05.0138")'), false, "same build is not newer:");
  eq(w.eval('buildIsNewer("zzz","2026-10-05.2030")'),             false, "junk must not count as newer:");

  // 3. the URL it fetches carries no stale query string from this session
  ok(!/[?#]/.test(w.eval("APP_URL")), "APP_URL must drop any query and hash: " + w.eval("APP_URL"));

  const saved = w.eval("JSON.stringify([latestBuild, updateReady, updDismissed])");
  const realFetch = w.fetch;
  try {
    // 4. a newer page raises the bar, with something to tap
    w.fetch = () => Promise.resolve({
      ok: true, text: () => Promise.resolve('const BUILD = "2099-01-01.0001";')
    });
    eq(await w.checkForUpdate(true), true, "a much newer build should be offered:");
    const bar = document.getElementById("updbar");
    ok(bar.className.includes("on"), "the update bar stayed hidden");
    ok(document.getElementById("updnow"), "no button to take the update");
    ok(bar.textContent.includes("2099-01-01.0001"), "the bar doesn't name the new build");

    // 5. "Later" puts it away without pretending it isn't there
    click(document.getElementById("upddismiss"));
    ok(!document.getElementById("updbar").className.includes("on"), "Later didn't dismiss the bar");
    eq(w.eval("updateReady"), true, "dismissing must not clear the pending update:");

    // 6. the same build raises nothing
    w.fetch = () => Promise.resolve({
      ok: true, text: () => Promise.resolve('const BUILD = "' + w.eval("BUILD") + '";')
    });
    eq(await w.checkForUpdate(true), false, "the current build is not an update:");
    ok(!document.getElementById("updbar").className.includes("on"), "bar shown for the current build");

    // 7. a dead spot must fail quietly, not throw into the scoring screen
    w.fetch = () => Promise.reject(new Error("offline"));
    eq(await w.checkForUpdate(true), false, "a failed check must report no update:");
  } finally {
    w.fetch = realFetch;
    const [lb, ur, ud] = JSON.parse(saved);
    w.eval(`latestBuild=${JSON.stringify(lb)}; updateReady=${JSON.stringify(ur)};
            updDismissed=${JSON.stringify(ud)}; paintUpdate(); render();`);
  }
});

section("2v2v2v2 — four teams, top two through");

/* Build a finished four-team scramble with the totals given, so the top-two
   rule can be asserted against known numbers rather than whatever a render
   happens to produce. */
function fourTeamGame(totals){
  const w = dom.window;
  return w.eval(`(function(){
    const tot = ${JSON.stringify(totals)};
    const g = { id:"g2x4", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
                teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]},
                holes: blankHoles() };
    for (let h = 0; h < 18; h++)
      tot.forEach((t, i) => { g.holes[h].teamScore[i] = (h === 0 ? t - 17 : 1); });
    GAMES.push(g);
    return JSON.stringify(strokeTotals(g).totals);
  })()`);
}
const outcomes = () => JSON.parse(dom.window.eval('JSON.stringify(teamOutcomes(GAMES.find(g=>g.id==="g2x4")))'));

t("R75 four teams score as stroke play, lowest total first", () => isolate(() => {
  const w = dom.window;
  eq(fourTeamGame([70,72,74,76]), "[70,72,74,76]", "totals should add up per team:");
  const g = w.eval('JSON.stringify(gameResult(GAMES.find(x=>x.id==="g2x4")))');
  ok(g !== "null", "a finished four-team game should have a result");
  eq(JSON.parse(g).winner, "A", "the lowest total should win:");
  eq(w.eval('winnerLabel(GAMES.find(x=>x.id==="g2x4"), "C")'),
     w.eval('teamLabel(GAMES.find(x=>x.id==="g2x4"), 2)'),
     "side C must resolve to the third team, not fall back to A:");
  ok(w.eval('winnerLabel(GAMES.find(x=>x.id==="g2x4"), "C")')
     !== w.eval('teamLabel(GAMES.find(x=>x.id==="g2x4"), 0)'),
     "and C must not be the same as A");
}));

t("R76 the top two win and the bottom two lose", () => isolate(() => {
  fourTeamGame([70,72,74,76]);
  eq(outcomes().join(","), "W,W,L,L", "a clean split:");
}));

t("R77 a tie across the cut is a tie, not a coin toss", () => isolate(() => {
  /* 72 and 72 are second and third. There's no honest way to say which went
     through, so both are tied rather than one arbitrarily promoted. */
  fourTeamGame([70,72,72,75]);
  eq(outcomes().join(","), "W,T,T,L", "a tie straddling the cut:");
}));

t("R78 a tie for the lead still sends both through", () => isolate(() => {
  fourTeamGame([70,70,75,76]);
  eq(outcomes().join(","), "W,W,L,L", "two clear leaders:");
}));

t("R79 four teams all square is a tie for everyone", () => isolate(() => {
  fourTeamGame([72,72,72,72]);
  eq(outcomes().join(","), "T,T,T,T", "nobody can be separated:");
}));

t("R80 the leaderboard credits all four teams", () => isolate(() => {
  const w = dom.window;
  w.eval("GAMES.length = 0;");                 // this game alone, so the sums are readable
  fourTeamGame([70,72,74,76]);
  const s = JSON.parse(w.eval("JSON.stringify(standings())"));
  const by = {}; s.forEach(r => by[r.name] = r);
  ["Blake","Dan"].forEach(n => {
    eq(by[n].w, 1, n + " was on a winning team:");
    eq(by[n].gp, 1, n + " played one game:");
  });
  ["Howard","Luke","Jake","Adam"].forEach(n => eq(by[n].l, 1, n + " was in the bottom half:"));
  eq(s.filter(r => r.gp > 0).length, 8, "all eight played, so all eight have a record:");
  eq(by["Blake"].pts, 1, "a win is a point:");
}));

t("R81 an unfinished four-team game scores nobody", () => isolate(() => {
  const w = dom.window;
  w.eval(`GAMES.push({ id:"g2x4", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
    teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() });
    GAMES.find(g=>g.id==="g2x4").holes[0].teamScore[0] = 4;`);
  eq(w.eval('gameResult(GAMES.find(g=>g.id==="g2x4"))'), null,
     "one score on one hole is not a result:");
  eq(w.eval('teamOutcomes(GAMES.find(g=>g.id==="g2x4"))'), null, "and credits nobody:");
}));

t("R82 four teams need four full sides, and a player sits on only one", () => isolate(() => {
  const w = dom.window;
  w.eval(`isAdmin = true;
    GAMES.push({ id:"g2x4", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams:{0:[],1:[],2:[],3:[]}, holes: blankHoles() });
    editEvent = ROUNDS()[0].id; view.tab = "sched"; view.gameId = null;
    openPanel.e = "games"; render();`);
  eq(JSON.parse(w.eval('JSON.stringify(NEEDED["SCRAMBLE2X4"])')).join(","), "2,2,2,2",
     "two players a side, four sides:");
  ok(document.querySelector('[data-side="g2x4:p1:3"]'), "there should be a D column");

  // putting a player on C must take them off A
  w.eval(`GAMES.find(g=>g.id==="g2x4").teams[0] = ["p1"];`);
  render_ = null;
  click(document.querySelector('[data-side="g2x4:p1:2"]'));
  const g = JSON.parse(w.eval('JSON.stringify(GAMES.find(x=>x.id==="g2x4").teams)'));
  eq((g[0]||[]).includes("p1"), false, "they should come off A:");
  eq((g[2]||[]).includes("p1"), true, "and land on C:");
}));

t("R83 pairings count the other six as opponents", () => isolate(() => {
  const w = dom.window;
  w.eval("GAMES.length = 0;");
  fourTeamGame([70,72,74,76]);
  const m = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m.withC["p1"]["p2"], 1, "team-mates play together:");
  eq(m.withC["p1"]["p3"], 0, "a different team is not a team-mate:");
  eq(m.agC["p1"]["p7"], 1, "someone two teams away is still an opponent:");
  eq(m.played["p1"], 1, "everyone played:");
  // two foursomes by default: A+B out together, C+D together
  eq(m.grpC["p1"]["p3"], 1, "teams A and B share a foursome:");
  eq(m.grpC["p1"]["p5"], 0, "team C is in the other group:");
  /* All eight out together contributes nothing to the foursome column: it
     would add one to all 28 pairs at once, which says nothing about how well
     the field is mixed and just burns everyone's cap. Team-mates and
     opponents from that round still count — those stay meaningful. */
  w.eval('GAMES.find(g=>g.id==="g2x4").oneGroup = true;');
  const m2 = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  const ids = JSON.parse(w.eval("JSON.stringify(PLAYERS.map(p=>p.id))"));
  let shared = 0;
  ids.forEach((a,i) => ids.slice(i+1).forEach(b => { if (m2.grpC[a][b]) shared++; }));
  eq(shared, 0, "an eightsome should add nothing to the foursome counts:");
  eq(m2.withC["p1"]["p2"], 1, "but team-mates still count:");
  eq(m2.agC["p1"]["p7"], 1, "and opponents still count:");
  eq(m2.played["p1"], 1, "and it's still a game played:");
}));

t("R84 a 2v2v2v2 survives the template round trip", () => isolate(() => {
  const w = dom.window;
  const rows = [
    "Saturday,8:00am,ROUND,Pine Hollow",
    "Saturday,,GAME,,2V2V2V2,,,Blake,Dan,,,Jason,Daniel,,,Howard,Luke,,,Jake,Adam"
  ].join("\n");
  const plan = JSON.parse(w.eval(
    `JSON.stringify(parseCSV(CSV_HEAD + "\\n" + ${JSON.stringify(rows)}))`));
  eq(plan.errors.length, 0, "a well-formed row should import cleanly: " + plan.errors.join("; "));
  eq(plan.games.length, 1, "one game:");
  eq(plan.games[0].type, "SCRAMBLE2X4", "read as the four-team scramble:");
  const t = plan.games[0].teams;
  eq(Object.keys(t).length, 4, "four sides:");
  eq(t[0].length + t[1].length + t[2].length + t[3].length, 8, "all eight placed:");

  // export it again and the row must come back the same
  w.eval(`applyCSV(parseCSV(CSV_HEAD + "\\n" + ${JSON.stringify(rows)}))`);
  const back = w.eval("scheduleToCSV()");
  const line = back.split("\n").find(l => /2V2V2V2/.test(l));
  ok(line, "the export should name the format the importer understands");
  ["Blake","Dan","Jason","Daniel","Howard","Luke","Jake","Adam"].forEach(n =>
    ok(line.includes(n), n + " should survive the round trip"));
  // re-importing what we exported must be clean too
  const again = JSON.parse(w.eval("JSON.stringify(parseCSV(scheduleToCSV()))"));
  eq(again.errors.length, 0, "re-importing the export should be clean: " + again.errors.join("; "));
}));

t("R85 names in columns a format doesn't use are reported", () => {
  const w = dom.window;
  /* Four names in c and d on a 2v2 means the row is in the wrong format —
     silently dropping them would lose half a game. */
  const bad = "Saturday,8:00am,ROUND,Pine Hollow\n"
    + "Saturday,,GAME,,BESTBALL,,,Blake,Dan,,,Jason,Daniel,,,Howard,Luke";
  const plan = JSON.parse(w.eval(
    `JSON.stringify(parseCSV(CSV_HEAD + "\\n" + ${JSON.stringify(bad)}))`));
  ok(plan.errors.some(e => /Howard/.test(e) && /later column/.test(e)),
     "it should name who ended up somewhere the format doesn't use: " + plan.errors.join("; "));
});

t("R86 a four-team hole isn't finished until all four have locked", () => isolate(() => {
  const w = dom.window;
  /* It moved on as soon as A and B were locked, so the hole looked closed to
     C and D before they'd entered anything. */
  w.eval(`GAMES.push({ id:"gadv", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
    teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() });
    view.gameId = "gadv"; view.hole = 0; isAdmin = true; render();`);
  const g = () => w.eval('GAMES.find(x => x.id === "gadv")');

  // two of four locked: stay put
  w.eval(`(function(){ const x = GAMES.find(y=>y.id==="gadv");
    [0,1].forEach(t => { x.holes[0].teamScore[t] = 4; x.holes[0].locked[t] = true; });
    maybeAdvance(x, 0, "Locked"); })()`);
  eq(w.eval("view.hole"), 0, "two of four locked should not move the hole on:");
  eq(w.eval('currentHoleFor(GAMES.find(x=>x.id==="gadv"))'), 0,
     "and the round is still on hole 1:");

  // the hole strip must not call it done either
  const strip = [...document.querySelectorAll(".hcell")];
  w.eval("render();");
  ok(!document.querySelectorAll(".hcell")[0].className.includes("done"),
     "hole 1 should not be marked finished with two teams still to score");

  // all four: now it moves
  w.eval(`(function(){ const x = GAMES.find(y=>y.id==="gadv");
    [2,3].forEach(t => { x.holes[0].teamScore[t] = 5; x.holes[0].locked[t] = true; });
    maybeAdvance(x, 0, "Locked"); })()`);
  eq(w.eval("view.hole"), 1, "all four locked should move to the next hole:");
  eq(w.eval('currentHoleFor(GAMES.find(x=>x.id==="gadv"))'), 1, "and that's the hole they're on:");
  w.eval('view.gameId = null; view.hole = 0; render();');
}));

t("R87 a scramble in progress never reports a 40ball budget", () => isolate(() => {
  const w = dom.window;
  /* The card label went result -> match play -> 40ball, with no stroke branch
     at all, so every scramble with a score in it claimed a 40-ball budget.
     An unstarted one read "Not started", which hid it. */
  ["SCRAMBLE4","SCRAMBLE3","SCRAMBLE2X4"].forEach(type => {
    w.eval(`(function(){
      const n = NEEDED[${JSON.stringify(type)}];
      const g = { id:"gs", roundId: ROUNDS()[0].id, type:${JSON.stringify(type)},
                  teams:{}, holes: blankHoles() };
      const pool = PLAYERS.map(p => p.id);
      let k = 0;
      n.forEach((need, i) => { g.teams[i] = pool.slice(k, k + need); k += need; });
      GAMES = GAMES.filter(x => x.id !== "gs");
      GAMES.push(g);
      // part way round: a few holes scored for every side
      for (let h = 0; h < 5; h++) sides(g).forEach(i => g.holes[h].teamScore[i] = 4 + i);
    })()`);
    const st = JSON.parse(w.eval('JSON.stringify(gameStatusLabel(GAMES.find(g=>g.id==="gs")))'));
    ok(!/40/.test(st.text), type + " should not mention a 40ball budget: " + st.text);
    ok(!/spent/i.test(st.text), type + " should not mention anything spent: " + st.text);
    ok(/thru 5/.test(st.text), type + " should say how far they are: " + st.text);
    eq(st.cls, "live", type + " in progress should read as live:");

    // and before anyone has scored
    w.eval('GAMES.find(g=>g.id==="gs").holes = blankHoles();');
    const st0 = JSON.parse(w.eval('JSON.stringify(gameStatusLabel(GAMES.find(g=>g.id==="gs")))'));
    eq(st0.text, "Not started", type + " with no scores:");
  });

  // 40ball itself must keep its budget line
  w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    if (!g) return;
    g.holes[0].locked[0] = true; g.holes[0].locked[1] = true;
  })()`);
  const fb = w.eval(`(function(){ const g = GAMES.find(x => x.type === "FORTYBALL");
    return g ? gameStatusLabel(g).text : "/40"; })()`);
  ok(/\/40/.test(fb), "40ball should still show its budget: " + fb);
}));

t("R98 a stroke-play card says who's ahead, not four bare numbers", () => isolate(() => {
  const w = dom.window;
  /* "7 - 7 - 10 - 10" tells you nothing: the totals are meaningless without
     the par played so far, and four numbers don't say whose they are. */
  const mk = (type, totals, holes) => {
    w.eval(`(function(){
      GAMES.length = 0;
      const n = NEEDED[${JSON.stringify(type)}];
      const g = { id:"gst", roundId: ROUNDS()[0].id, type:${JSON.stringify(type)},
                  teams:{}, holes: blankHoles() };
      const pool = PLAYERS.map(p => p.id); let k = 0;
      n.forEach((need,i) => { g.teams[i] = pool.slice(k, k+need); k += need; });
      const tot = ${JSON.stringify(totals)};
      for (let h = 0; h < ${holes}; h++)
        tot.forEach((t,i) => { g.holes[h].teamScore[i] = (h === 0 ? t - (${holes}-1)*4 : 4); });
      GAMES.push(g);
    })()`);
    return JSON.parse(w.eval('JSON.stringify(gameStatusLabel(GAMES.find(g=>g.id==="gst")))')).text;
  };

  // a clear leader is named, with the margin and their score to par
  const lead = mk("SCRAMBLE2X4", [7,9,10,11], 3);
  ok(/leads by 2/.test(lead), "it should say how big the lead is: " + lead);
  ok(/-4|\u22124/.test(lead), "and where they stand against par: " + lead);
  ok(/thru 3/.test(lead), "and how far they've got: " + lead);
  ok(!/7 . 9 . 10 . 11/.test(lead), "bare totals say nothing: " + lead);

  // a tie for the lead names both teams in full — "Blake / Jake" read as a
  // pairing, and those two are on different teams
  const tie = mk("SCRAMBLE2X4", [7,7,10,10], 3);
  ok(/tied/.test(tie), "a shared lead should say tied: " + tie);
  ok(/ and /.test(tie), "the two teams should be joined by 'and', not a slash: " + tie);
  ok(!/\//.test(tie), "a slash between names reads as a team: " + tie);
  const t0 = w.eval('teamLabel(GAMES.find(g=>g.id==="gst"), 0)');
  const t1 = w.eval('teamLabel(GAMES.find(g=>g.id==="gst"), 1)');
  ok(tie.includes(t0) && tie.includes(t1),
     "both tied teams should be named in full: " + tie);

  // three or more tied is counted rather than listed
  const many = mk("SCRAMBLE2X4", [7,7,7,10], 3);
  ok(/3 teams tied/.test(many), "three tied teams should be counted: " + many);

  // a team of more than two is named as a team, not as one person
  const four = mk("SCRAMBLE4", [33,36], 9);
  ok(/'s team/.test(four), "a 4v4 side should read as a team, not a player: " + four);

  // everybody level
  ok(/All level/.test(mk("SCRAMBLE2X4", [9,9,9,9], 3)), "four teams level");
  ok(/All level/.test(mk("SCRAMBLE4", [36,36], 9)), "two teams level");

  // the line still has to fit a phone card
  const big = mk("SCRAMBLE4", [33,36], 9);
  ok(big.length < 45, "the line must fit a phone card: " + big);
  ok(!/,.*,.*&/.test(big), "a 4v4 shouldn't list all four names: " + big);

  // nothing scored yet
  ok(/Not started/.test(mk("SCRAMBLE2X4", [0,0,0,0], 0)), "before anyone tees off");
}));

t("R99 scrambles show which tee each player is on", () => isolate(() => {
  const w = dom.window;
  /* No handicaps in a scramble, so the tee is the only thing separating two
     players on paper — it belongs next to the name, not buried on Field. */
  w.eval(`isAdmin = true; GAMES.length = 0;
    GAMES.push({ id:"gt", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() });
    PLAYERS[0].tees = PLAYERS[0].tees || {};
    PLAYERS[0].tees[courseOf(GAMES[0]).id] = courseOf(GAMES[0]).tees[1].name;
    view.gameId = "gt"; view.hole = 0; render();`);
  const want = w.eval('teeNameFor("p1", courseOf(GAMES.find(g=>g.id==="gt")))');
  const row = document.querySelector(".team .pname").textContent;
  ok(row.includes(want), "the score row should show the tee: " + row);
  ok(document.querySelector(".teetag"), "and show it as its own tag, not run into the name");

  // and in the setup, where the teams get picked
  w.eval(`view.gameId = null; editEvent = ROUNDS()[0].id; view.tab = "sched";
          openPanel.e = "games"; render();`);
  const cell = document.querySelector(".rost .rn");
  ok(cell && /\S/.test(cell.textContent), "the roster editor should still list players");
  ok(cell.querySelector(".teetag"), "and show each player's tee while sides are being picked");

  // a player with no tee set falls back rather than printing undefined
  w.eval('delete PLAYERS[0].tees; render();');
  ok(!/undefined/.test(appHTML()), "a player with no tee recorded must not print undefined");
}));

section("COLD REVIEW — found by a reviewer who hadn't seen the code")

t("R88 the open game disappearing doesn't freeze the app", () => isolate(() => {
  const w = dom.window;
  /* render() dereferenced the game without checking it still existed, so an
     admin deleting a round froze every phone that had one of its games open —
     and because handleClick's catch calls render(), every later tap threw too. */
  w.eval('view.gameId = "vanished"; view.hole = 0;');
  w.eval("render()");                                   // must not throw
  eq(w.eval("view.gameId"), null, "it should drop back out of the missing game:");
  ok(appHTML().length > 0, "and still draw something");
}));

t("R89 an empty or unknown side never prints \"undefined\"", () => {
  const w = dom.window;
  eq(w.eval('teamLabel({ teams:{0:[]} }, 0)'), "Team A", "an empty side needs a name:");
  eq(w.eval('teamShort({ teams:{0:[]} }, 0)'), "Team A", "including the short form:");
  eq(w.eval('teamLabel({ teams:{0:["ghost"]} }, 0)'), "Team A",
     "a player who left the roster shouldn't become undefined:");
  eq(w.eval('teamLabel({ teams:{0:["p1","ghost"]} }, 0)'), w.eval('P("p1").name'),
     "the real names should survive:");
  ok(!/undefined/.test(w.eval('teamsLine({ type:"BESTBALL", teams:{0:[],1:[]} })')),
     "a half-built game must not render as undefined");
});

t("R90 the standings don't show undefined beside a handicap", () => {
  const w = dom.window;
  w.eval('view.gameId = null; view.tab = "board"; boardMode = "table"; render();');
  ok(!/undefined/.test(appHTML()), "the standings table printed undefined: p.tee never existed");
});

ta("R91 Reset everything actually resets", async () => {
  const w = dom.window;
  /* It wrote the CURRENT players, courses, schedule and games straight back —
     scores included — so confirming the scariest dialog in the app discarded
     nothing whatsoever. Async, because the restore has to happen after the
     assertions, not before them. */
  const saved = w.eval("JSON.stringify([PLAYERS, COURSES, SCHEDULE, DAYS, GAMES])");
  try {
    w.eval(`SYNC.on = false;
      PLAYERS[0].index = 99.9;
      SCHEDULE.push({ id:"junk", day:DAYS[0], type:"OTHER", title:"should not survive" });
      GAMES[0].holes[0].scores["p1"] = 7;`);
    await w.resetTournament();
    ok(w.eval("PLAYERS[0].index") !== 99.9, "handicaps should go back to the defaults");
    ok(!w.eval('SCHEDULE.some(e => e.id === "junk")'), "added events should be gone");
    eq(w.eval("Object.keys(GAMES[0].holes[0].scores).length"), 0, "scores should be wiped:");
    ok(w.eval("GAMES.length") > 0, "and the defaults should be back, not an empty tournament");
  } finally {
    const [p, c, sc, d, g] = JSON.parse(saved);
    w.eval(`PLAYERS.length=0; ${JSON.stringify(p)}.forEach(x=>PLAYERS.push(x));
            COURSES.length=0; ${JSON.stringify(c)}.forEach(x=>COURSES.push(x));
            SCHEDULE.length=0; ${JSON.stringify(sc)}.forEach(x=>SCHEDULE.push(x));
            DAYS.length=0; ${JSON.stringify(d)}.forEach(x=>DAYS.push(x));
            GAMES = ${JSON.stringify(g)}; editCourseId = COURSES[0].id; render();`);
  }
});

t("R92 a queued score for a game that no longer exists can't jam the queue", () => isolate(() => {
  const w = dom.window;
  /* The queue is strictly in order and broke out of the loop on any failure,
     so one orphan — a game another phone deleted — blocked every later write
     for every game, for good, and survived reload. */
  const src = html.slice(html.indexOf("async function flushQueue"),
                         html.indexOf("async function flushQueue") + 1400);
  const notFound = src.slice(src.indexOf("not-found"));
  ok(/dequeue\(it\); continue;[\s\S]{0,120}\}/.test(notFound),
     "a write for a game that's gone must be dropped, not left blocking the queue");
}));

t("R93 the score export prints every side", () => isolate(() => {
  const w = dom.window;
  w.eval(`GAMES.length = 0;
    const g = { id:"gx", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() };
    for (let h = 0; h < 18; h++) sides(g).forEach(i => g.holes[h].teamScore[i] = 4 + i);
    GAMES.push(g);`);
  const txt = w.eval("scoresToText()");
  const hdr = txt.split("\n").find(l => /Hole\s+Par/.test(l)) || "";
  [0,1,2,3].forEach(i => {
    const n = w.eval(`teamShort(GAMES.find(g=>g.id==="gx"), ${i})`).slice(0,8);
    ok(hdr.includes(n), "side " + i + " (" + n + ") missing from the export: " + hdr);
  });
  const total = txt.split("\n").find(l => /TOTAL/.test(l)) || "";
  eq(total.trim().split(/\s+/).length - 1, 4, "a total per side:");
}));

t("R94 migration keeps all four sides of a 2v2v2v2", () => isolate(() => {
  const w = dom.window;
  /* The array-shape repair hardcoded keys 0 and 1, so C and D were dropped —
     and then written back to the server. */
  w.eval(`cfgDirty = false;
    GAMES.push({ id:"garr", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams: [["p1","p2"],["p3","p4"],["p5","p6"],["p7","p8"]], holes: blankHoles() });
    migrateLoaded();`);
  const t = JSON.parse(w.eval('JSON.stringify(GAMES.find(g=>g.id==="garr").teams)'));
  eq(Object.keys(t).length, 4, "all four sides should survive:");
  eq((t[2]||[]).join(","), "p5,p6", "side C intact:");
  eq((t[3]||[]).join(","), "p7,p8", "side D intact:");
}));

t("R95 two 2v2v2v2 games differing only in C and D aren't called duplicates", () => isolate(() => {
  const w = dom.window;
  const key = g => w.eval(`(function(){ const x = ${JSON.stringify(g)};
    return sides(x).map(i => (x.teams[i]||[]).slice().sort().join("+")).join("|"); })()`);
  const a = { type:"SCRAMBLE2X4", roundId:"r", teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]} };
  const b = { type:"SCRAMBLE2X4", roundId:"r", teams:{0:["p1","p2"],1:["p3","p4"],2:["p7","p8"],3:["p5","p6"]} };
  const c = { type:"SCRAMBLE2X4", roundId:"r", teams:{0:["p1","p2"],1:["p3","p4"],2:["p1","p3"],3:["p5","p6"]} };
  ok(key(a) !== key(c), "different C and D must hash differently, or one gets deleted as a dupe");
  eq(key(a), key(a), "the key is stable:");
}));

t("R96 a part-scored scramble still warns before the roster is changed", () => isolate(() => {
  const w = dom.window;
  /* The check only looked at side A, so a 2v2v2v2 where B, C and D had scored
     let an admin reshuffle without being told holes would be re-scored. */
  w.eval(`GAMES.push({ id:"gw", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
    teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() });
    GAMES.find(g=>g.id==="gw").holes[0].teamScore[2] = 4;`);
  ok(/already has scores/.test(w.eval('gameEditor(GAMES.find(g=>g.id==="gw"))')),
     "a score on side C counts as scores");
}));

t("R97 a round pointing at a deleted course is repaired", () => isolate(() => {
  const w = dom.window;
  /* C() falls back to COURSES[0], so the old guard `!C(id)` was unreachable
     and the round silently played off the wrong card's stroke indexes. */
  w.eval(`cfgDirty = false;
    SCHEDULE.push({ id:"rbad", day:DAYS[0], type:"ROUND", title:"", courseId:"deleted-course" });
    migrateLoaded();`);
  ok(w.eval('COURSES.some(c => c.id === EV("rbad").courseId)'),
     "the round should be pointed at a course that exists");
}));

section("DELETION — things must stay deleted");

/* The gap that let deletions come back: every test above drives the UI with
   the database standing still. In life a snapshot lands a moment later,
   carrying what the server had BEFORE the delete — and the listener rebuilds
   the whole list from it. These fake that sequence. */
function fakeSnapshot(games){
  const w = dom.window;
  w.eval(`(function(){
    const rows = ${JSON.stringify(games)};
    forgetDead();
    const fresh = [];
    const present = new Set();
    rows.forEach(v => {
      present.add(v.id);
      if (deadGames.has(v.id)) return;
      fresh.push(v);
    });
    deadGames.forEach((t, id) => { if (!present.has(id)) deadGames.delete(id); });
    GAMES = fresh;
    applyQueueLocally();
  })()`);
}
const gameRows = () => JSON.parse(dom.window.eval("JSON.stringify(GAMES)"));

t("R63 a deleted game stays deleted when a stale snapshot arrives", () => isolate(() => {
  const w = dom.window;
  w.eval(`cfgDirty = false; SYNC.on = true;
          SYNC.api = { doc:()=>({}), deleteDoc:()=>Promise.resolve(),
          setDoc:()=>Promise.resolve(), updateDoc:()=>Promise.resolve() };`);
  try {
    const before = gameRows();
    ok(before.length >= 2, "this test needs at least two games to work with");
    const victim = before[0].id;
    w.eval(`removeGame(${JSON.stringify(victim)})`);
    ok(!gameRows().some(g => g.id === victim), "it should go immediately");

    // the server hadn't caught up yet and sends the old list back
    fakeSnapshot(before);
    ok(!gameRows().some(g => g.id === victim),
       "a snapshot from before the delete must not bring it back");

    // nor should the next one, while the server is still catching up
    fakeSnapshot(before);
    ok(!gameRows().some(g => g.id === victim), "nor the one after that");

    // once the server really has dropped it, the others are untouched
    fakeSnapshot(before.filter(g => g.id !== victim));
    eq(gameRows().length, before.length - 1, "exactly one game should be gone:");

    // and a game deleted on ANOTHER phone still disappears here
    const other = gameRows()[0].id;
    fakeSnapshot(gameRows().filter(g => g.id !== other));
    ok(!gameRows().some(g => g.id === other),
       "a delete from another device must still apply");
  } finally {
    w.eval("SYNC.on = false; SYNC.api = null; deadGames.clear();");
  }
}));

t("R64 deleting a round does not quietly recreate it", () => isolate(() => {
  const w = dom.window;
  /* migrateLoaded used to adopt any game whose roundId didn't resolve — which
     is exactly what a deleted round leaves behind. It invented a replacement
     round, on a guessed day, and wrote it back. That is how a deleted Thursday
     round reappeared. */
  w.eval('view.gameId = null; editEvent = null; isAdmin = true; cfgDirty = false;');
  const roundId = w.eval('ROUNDS()[0].id');
  const roundsBefore = w.eval("ROUNDS().length");
  const kids = w.eval(`GAMES.filter(g => g.roundId === ${JSON.stringify(roundId)}).length`);
  ok(kids > 0, "pick a round that actually has games");

  w.eval(`(function(){
    GAMES.filter(g => g.roundId === ${JSON.stringify(roundId)}).forEach(g => removeGame(g.id));
    SCHEDULE = SCHEDULE.filter(x => x.id !== ${JSON.stringify(roundId)});
  })()`);
  eq(w.eval("ROUNDS().length"), roundsBefore - 1, "the round should be gone:");

  w.eval("migrateLoaded()");
  eq(w.eval("ROUNDS().length"), roundsBefore - 1,
     "migrateLoaded must not invent a replacement round:");
  eq(w.eval(`GAMES.filter(g => g.roundId === ${JSON.stringify(roundId)}).length`), 0,
     "its games should be gone too:");
}));

t("R65 a game orphaned by a deleted round is removed, not re-homed", () => isolate(() => {
  const w = dom.window;
  w.eval(`cfgDirty = false;`);        // migrateLoaded stands down while a save is pending
  w.eval(`GAMES.push({ id:"ghost", roundId:"roundThatIsGone", type:"BESTBALL",
                       teams:{0:["p1","p2"],1:["p3","p4"]}, holes: blankHoles() });
          migrateLoaded();`);
  ok(!w.eval('GAMES.some(g => g.id === "ghost")'),
     "a game pointing at a round that doesn't exist should be dropped");
  ok(!w.eval('SCHEDULE.some(e => e.id === "roundThatIsGone")'),
     "and no round should be conjured up for it");
}));

t("R66 truly legacy games are still rescued", () => isolate(() => {
  const w = dom.window;
  /* The flip side: games written before rounds had ids carry a `round` label
     and no roundId at all. Those must still find a home, or old data is lost. */
  w.eval("cfgDirty = false;");
  const n = w.eval("ROUNDS().length");
  w.eval(`GAMES.push({ id:"legacy", round:"Friday morning", courseId: COURSES[0].id,
                       type:"BESTBALL", teams:{0:["p1","p2"],1:["p3","p4"]},
                       holes: blankHoles() });
          migrateLoaded();`);
  ok(w.eval('GAMES.some(g => g.id === "legacy")'), "a legacy game must not be thrown away");
  const rid = w.eval('(GAMES.find(g => g.id === "legacy")||{}).roundId');
  ok(rid, "it should have been given a roundId");
  ok(w.eval(`!!EV(${JSON.stringify(rid)})`), "and that round should exist");
  ok(w.eval("ROUNDS().length") >= n, "rounds should not have been lost");
}));

t("R67 queued scores for a deleted game don't resurrect it", () => isolate(() => {
  const w = dom.window;
  w.eval(`SYNC.on = true; SYNC.api = { doc:()=>({}), deleteDoc:()=>Promise.resolve(),
          setDoc:()=>Promise.resolve(), updateDoc:()=>Promise.resolve() };`);
  try {
    const gid = gameRows()[0].id;
    w.eval(`queue.push({ gid:${JSON.stringify(gid)}, h:0, path:"scores.p1", val:4 });
            removeGame(${JSON.stringify(gid)});`);
    eq(w.eval(`queue.filter(it => it.gid === ${JSON.stringify(gid)}).length`), 0,
       "its queued writes should go with it:");
    w.eval("applyQueueLocally()");
    ok(!gameRows().some(g => g.id === gid), "and it must not come back");
  } finally {
    w.eval("SYNC.on = false; SYNC.api = null; deadGames.clear(); queue.length = 0;");
  }
}));

t("R68 a deletion is written out at once, not left in a debounce", () => {
  /* A deletion parked on the 700ms typing debounce is a deletion that an
     incoming config snapshot can undo. */
  ["delev", "clearday"].forEach(which => {
    const m = new RegExp("el\\.dataset\\." + which + "[\\s\\S]{0,900}?pushConfig\\(\\)");
    ok(m.test(html), which + " should push the config immediately, not queue it");
  });
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

ta("R70 a failed config write doesn't wedge the phone", async () => {
  const w = dom.window;
  /* cfgDirty left set forever makes the phone deaf to the server: both
     migrateLoaded and the config listener stand down while it's set, so the
     schedule would never update from anyone else again. */
  const saved = w.eval("JSON.stringify([cfgDirty, cfgRetry, SYNC.on])");
  try {
    w.eval(`cfgDirty = true; cfgRetry = true; SYNC.on = true;
      SYNC.api = { doc:()=>({}), setDoc:()=>Promise.reject({ code:"unavailable" }) };
      pushConfig();`);
    await new Promise(r => setTimeout(r, 20));
    eq(w.eval("cfgDirty"), false,
       "after a retry has already failed, the server must be let through again:");
  } finally {
    const [d, r, on] = JSON.parse(saved);
    w.eval(`cfgDirty=${JSON.stringify(d)}; cfgRetry=${JSON.stringify(r)};
            SYNC.on=${JSON.stringify(on)}; SYNC.api=null;`);
  }
});

ta("R71 the games list is read from the server, not just the cache", async () => {
  const w = dom.window;
  /* The bug this comes from: kickServer forced a server read of the CONFIG
     document only, then set serverSeen — so a games listener serving from
     Firestore's local cache was never noticed or corrected. The phone showed
     a pre-delete snapshot of the games all session while its schedule was
     perfectly current, which is exactly "I deleted it and it still shows". */
  ok(/getDocsFromServer/.test(html),
     "the games collection must be read from the server, not left to the listener");
  ok(/kickServer\([^)]*gamesRef/.test(html) || /kickServer\(myGen, cfgRef, gamesRef\)/.test(html),
     "kickServer needs the games collection to read it");

  const saved = w.eval("JSON.stringify([SYNC.on, SYNC.cache.games, GAMES.length])");
  try {
    // a server read returning one game must replace a stale cached list
    w.eval(`SYNC.cache.games = true;
      SYNC.api = { getDocsFromServer: () => Promise.resolve({
        forEach(fn){ [{ id:"srv1", data:() => ({ id:"srv1", roundId: ROUNDS()[0].id,
          type:"BESTBALL", teams:{0:["p1","p2"],1:["p3","p4"]}, holes: blankHoles() }) }]
          .forEach(fn); }
      }) };`);
    const got = await w.kickGames(w.eval("gen"), {});
    eq(got, true, "a server read should report success:");
    eq(w.eval("GAMES.length"), 1, "the list should be replaced by what the server holds:");
    eq(w.eval("SYNC.cache.games"), false, "and it should stop calling itself cache-only:");

    // a game deleted here must not come back through that server read either
    w.eval(`deadGames.set("srv1", Date.now()); SYNC.cache.games = true;`);
    await w.kickGames(w.eval("gen"), {});
    ok(!w.eval('GAMES.some(g => g.id === "srv1")'),
       "a just-deleted game must not return via the server read");
  } finally {
    const [on, cache, n] = JSON.parse(saved);
    w.eval(`SYNC.on=${JSON.stringify(on)}; SYNC.cache.games=${JSON.stringify(cache)};
            SYNC.api=null; deadGames.clear();`);
  }
});

t("R72 a cache-only games list is said out loud, not buried in diagnostics", () => isolate(() => {
  const w = dom.window;
  w.eval(`SYNC.on = true; SYNC.state = "live"; SYNC.cache.games = true;
          view.gameId = null; view.tab = "home"; render();`);
  ok(/out of date/i.test(appHTML()), "the home screen should say the games may be stale");
  ok(document.getElementById("refreshgames"), "and offer a way to pull them fresh");
  w.eval(`SYNC.cache.games = false; render();`);
  ok(!document.getElementById("refreshgames"), "and say nothing once it's current");
  w.eval(`SYNC.on = false; SYNC.state = "local"; render();`);
}));

t("R73 the time field is the phone's own wheel", () => isolate(() => {
  const w = dom.window;
  /* Typing "8:10am" meant swapping the iPhone keyboard between letters and
     numbers for every tee time. <input type="time"> is the alarm-clock wheel:
     hours, minutes, AM/PM, every minute, in the phone's own format, and its
     value is already the "HH:MM" the schedule stores. */
  w.eval(`isAdmin = true;
    SCHEDULE.push({ id:"rTime", day:DAYS[0], time:null, type:"ROUND", title:"",
                    courseId: COURSES[0].id });
    openEvent("rTime", false); view.tab = "sched"; view.gameId = null; render();`);
  const inp = document.getElementById("evtime");
  ok(inp, "no time field");
  eq(inp.type, "time", "it must be a real time input, not a text box or hand-drawn grid:");
  eq(inp.value, "", "an unset time should start empty:");
  ok(/TBD/.test(appHTML()), "and say it'll show as TBD");

  // the wheel reports as it spins; a redraw would close it, so there must be none
  inp.value = "08:07";
  inp.dispatchEvent(new window.Event("input", { bubbles:true }));
  eq(w.eval('EV("rTime").time'), "08:07", "an exact minute should be stored:");
  eq(w.eval('fmtTime(EV("rTime").time)'), "8:07am", "and read back in 12-hour time:");
  ok(document.getElementById("evtime") === inp,
     "the field must not be re-rendered mid-spin, or the wheel shuts");

  // afternoons survive the round trip
  inp.value = "18:30";
  inp.dispatchEvent(new window.Event("change", { bubbles:true }));
  eq(w.eval('fmtTime(EV("rTime").time)'), "6:30pm", "an evening time must not become morning:");

  // and TBD clears it
  click(document.querySelector('[data-settime="clear"]'));
  eq(w.eval('EV("rTime").time'), null, "TBD should leave it unset:");
  w.eval("closeEvent(true)");
}));

t("R74 one way to add to a day, not two that lead to the same screen", () => {
  const w = dom.window;
  w.eval('isAdmin = true; editEvent = null; view.gameId = null; view.tab = "sched"; schedMode = "timeline"; render();');
  const adds = [...document.querySelectorAll("[data-addround], [data-addev]")];
  const perDay = {};
  adds.forEach(b => {
    const day = b.dataset.addround || b.dataset.addev;
    perDay[day] = (perDay[day] || 0) + 1;
  });
  Object.keys(perDay).forEach(day =>
    eq(perDay[day], 1, "there should be exactly one add button for " + day + ":"));
  ok(adds.length, "there should be a way to add something to a day");
});

t("R69 no test left the tournament in a different shape than it found it", () => {
  const now = dom.window.eval("JSON.stringify({g:GAMES.length, s:SCHEDULE.length, d:DAYS.length, c:COURSES.length, p:PLAYERS.length})");
  const a = JSON.parse(WORLD0), b = JSON.parse(now);
  const names = { g:"games", s:"schedule events", d:"days", c:"courses", p:"players" };
  Object.keys(a).forEach(k => eq(b[k], a[k],
    "a test changed the number of " + names[k] + " and didn't restore it \u2014 wrap it in isolate():"));
});

/* ---------------- report ---------------- */
(async () => {
  if (deferred.length) section("ASYNC — things that have to be waited for");
  for (const [label, fn] of deferred){
    try { await fn(); pass++; console.log("  ok   " + label); }
    catch (e){
      fail++; fails.push(label + " — " + e.message);
      console.log("  FAIL " + label + "\n         " + e.message);
    }
  }
  console.log("\n" + "=".repeat(52));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) console.log("\nFailures:\n" + fails.map(f => " - " + f).join("\n"));
  /* jsdom's animation loop and the app's own timers keep the event loop alive,
     so say when we're done rather than hanging after the report. */
  process.exit(fail ? 1 : 0);
})();
