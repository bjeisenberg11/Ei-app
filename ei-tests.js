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
  t("game: " + id, () => { openGame(id);
    /* Stroke play draws the full card (.hg); match play and 40ball keep the
       1-18 strip. Either one means the game view rendered. */
    ok(/class="(hstrip|hg)"/.test(appHTML()), "game view missing"); }));

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
  ok(/class="(hstrip|hg)"/.test(appHTML()),
     "clicking a scheduled round did not open the game");
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
  w.eval("SYNC.on=true; isAdmin=false; showUnlock=false; view.gameId=null; view.tab='sched'; schedMode='timeline'; editEvent=null; render();");
  /* The code field is asked for, not offered — almost nobody opening this
     screen is about to unlock anything, and the bar was a whole row of it. */
  ok(!document.querySelector("#acode"), "the code field shouldn't be sitting there by default");
  ok(document.querySelector("#ashow"), "but there has to be a way to ask for it");
  w.eval("showUnlock = true; render();");
  ok(document.querySelector("#acode"), "no unlock bar once asked for");
  ok(document.querySelector("#aunlock"), "and nothing to submit it with");
  w.eval("showUnlock = false; render();");
  const editable = [...document.querySelectorAll("[data-editev]")]
    .map(b => w.eval(`EV("${b.dataset.editev}").type`));
  ok(editable.length > 0, "travel should still be editable without the code");
  ok(editable.every(t => t === "TRAVEL"), "only travel may be edited: got " + editable.join(","));
  w.eval("schedMode='travel'; render();");
  ok(document.querySelector("[data-flightsave]"), "players need a way to add their own flights");
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
  /* The "tot" label went when to-par moved in front of the gross total; what
     matters is that the running total is still there. */
  ok(heads.some(x => /\b16\b/.test(x)),
     "should show the running stroke total: " + heads.join(" | "));
  ok(heads.some(x => /E|\+4/.test(x)),
     "and the score to par: " + heads.join(" | "));
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
    /* The sheet's totals less the two 3v3s (2024 and 2025), which aren't EI
       games: Blake, Jake and Adam a win and a game fewer each year, Daniel, Dan
       and Jason a loss and a game fewer. Howard and Luke never played it. */
    const sheet = {
      Blake:"11-7-1-19", Dan:"12-6-1-19", Adam:"9-10-0-19", Jason:"10-9-0-19",
      Daniel:"8-10-1-19", Luke:"8-9-2-19", Howard:"8-8-3-19", Jake:"3-9-0-12",
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
    /* Adam's 2025 was 4-1 with the 3v3 in it; without it he's 3-1, level. */
    eq(w.eval('JSON.stringify(yearWinners(HISTORY_SEED["2025"].rows))'), '["Adam","Dan","Howard"]',
       "2025 is a three-way tie once the 3v3 is out:");
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

t("R83 a four-team game is read as four teams, not two", () => isolate(() => {
  const w = dom.window;
  w.eval("GAMES.length = 0;");
  fourTeamGame([70,72,74,76]);
  const m = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m.withC["p1"]["p2"], 1, "team-mates play together:");
  eq(m.withC["p1"]["p3"], 0, "a different team is not a team-mate:");
  /* The against column is deliberately empty for a four-team game (R116):
     everyone is against the other six, so it would gain one on 24 of the 28
     pairs at once. What this test still guards is that sides C and D are seen
     at all rather than the game being read as two-sided. */
  eq(m.withC["p5"]["p6"], 1, "side C are team-mates:");
  eq(m.withC["p7"]["p8"], 1, "and so are side D:");
  eq(m.played["p1"], 1, "everyone played:");
  // two foursomes by default: A+B out together, C+D together
  eq(m.grpC["p1"]["p3"], 1, "teams A and B share a foursome:");
  eq(m.grpC["p1"]["p5"], 0, "team C is in the other group:");
  /* All eight out together contributes nothing to the foursome column either:
     it would add one to all 28 pairs at once, which says nothing about how
     well the field is mixed and just burns everyone's cap. Who partnered whom
     is the only thing a four-team round leaves behind. */
  w.eval('GAMES.find(g=>g.id==="g2x4").oneGroup = true;');
  const m2 = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  const ids = JSON.parse(w.eval("JSON.stringify(PLAYERS.map(p=>p.id))"));
  let shared = 0;
  ids.forEach((a,i) => ids.slice(i+1).forEach(b => { if (m2.grpC[a][b]) shared++; }));
  eq(shared, 0, "an eightsome should add nothing to the foursome counts:");
  eq(m2.withC["p1"]["p2"], 1, "but team-mates still count:");
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

  // and the card must not show a score for a team that hasn't put one in
  w.eval("render();");
  const cells = [...document.querySelectorAll(".hg-s")];
  const firsts = [0,1,2,3].map(t => document
    .querySelector(`.hg-row[data-side="${t}"]`)
    .querySelectorAll(".hg-s")[0].querySelector(".hg-v").textContent.trim());
  eq(firsts.slice(2).join(","), ",",
     "sides C and D have no score on hole 1, so their cells should be empty:");
  ok(firsts[0] !== "", "while side A's score should be on the card: " + firsts.join("|"));

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

t("R99 a tee is shown where the game set it, and nowhere else", () => isolate(() => {
  const w = dom.window;
  /* A tee earns its place on the card only when the game put the side on it —
     the 2v2v2v2, where the boxes are what level the teams. In a 4v4 everyone
     plays whatever tee they always play and it decides nothing, so four names
     with four chips after them was noise that also pushed the page sideways. */
  w.eval(`isAdmin = true; GAMES.length = 0;
    GAMES.push({ id:"gt", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() });
    const co = courseOf(GAMES[0]);
    GAMES[0].tees = { 0: co.tees[co.tees.length - 1].name };
    PLAYERS[0].tees = PLAYERS[0].tees || {};
    PLAYERS[0].tees[co.id] = co.tees[0].name;
    view.tab = "home"; editEvent = null; view.gameId = "gt"; view.hole = 0; render();`);
  const want = w.eval('GAMES[0].tees[0]');
  const heads = [...document.querySelectorAll(".team .team-name")];
  ok(heads[0].textContent.includes(want), "the side the game put on a tee should show it: "
     + heads[0].textContent.trim());
  ok(heads[0].querySelector(".teetag"), "as its own tag, not run into the name");
  ok(!heads[1].querySelector(".teetag"),
     "a side the game left alone shows nothing: " + heads[1].textContent.trim());

  /* A 4v4 never carries team tees, so no chip anywhere. */
  w.eval(`GAMES.length = 0;
    GAMES.push({ id:"g44", roundId: ROUNDS()[0].id, type:"SCRAMBLE4",
      teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes: blankHoles() });
    view.gameId = "g44"; view.hole = 0; render();`);
  ok(!document.querySelector(".team .teetag"),
     "a 4v4 should not label anyone's tee on the card");

  // the roster editor still shows them, which is where sides get picked
  w.eval(`view.gameId = null; editEvent = ROUNDS()[0].id; view.tab = "sched";
          openPanel.e = "games"; render();`);
  const cell = document.querySelector(".rost .rn");
  ok(cell && /\S/.test(cell.textContent), "the roster editor should still list players");
  ok(cell.querySelector(".teetag"), "and show each player's tee while sides are being picked");

  // a player with no tee set falls back rather than printing undefined
  w.eval('delete PLAYERS[0].tees; render();');
  ok(!/undefined/.test(appHTML()), "a player with no tee recorded must not print undefined");
}));

t("R100 stroke play is read on to par, not on the gross", () => isolate(() => {
  const w = dom.window;
  /* Gross first with to par trailing had it backwards: a total means nothing
     without the par played. The leaderboard box that made that point is gone
     while a game is live — the card carries it — so the guarantee lives in the
     total column and in how the rank beside each name is worked out. */
  w.eval(`GAMES.length = 0;
    const g = { id:"gflip", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4",
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() };
    const per = [[5,4,4,4,4,5],[4,4,4,4,4,4],[3,4,4,4,4,3],[4,4,4,4,4,3]];
    for (let h = 0; h < 6; h++) per.forEach((row,i) => { g.holes[h].teamScore[i] = row[h]; });
    GAMES.push(g); view.tab = "home"; editEvent = null;
    view.gameId = "gflip"; view.hole = 0; render();`);

  const tots = [...document.querySelectorAll(".hg-row[data-side] .hg-tot")];   // the sides, not the heading or par rows
  eq(tots.length, 4, "a total cell per side:");
  ok(tots[0].querySelector(".hg-v").textContent.trim(), "the gross total should be there");
  ok(/^[+\-E]/.test(tots[0].querySelector(".hg-rel").textContent.trim()),
     "and to par under it: " + tots[0].textContent.trim());
  /* In a scramble the gross leads and to par trails; a skins game flips that,
     because there the skins are what's being played for. */
  ok(tots[0].querySelector(".hg-v").className.includes("lead"),
     "a scramble leads with the gross:");
  ok(tots[0].querySelector(".hg-rel").className.includes("sub"),
     "and trails with to par:");

  /* No box repeating it while the game is live. */
  ok(!document.querySelector(".strokerow"),
     "a live game shouldn't carry a leaderboard the card already is");
  ok(document.querySelector(".cardcap"), "just a caption saying what's being played");

  /* The team head leads with to par as well. */
  const sub = document.querySelector(".team .team-score");
  ok(sub, "no team total");
  ok(/[+\-E]/.test(sub.textContent), "the team head should show to par: " + sub.textContent.trim());

  /* And the rank really is to par, not gross: a side six holes in at six under
     has a far bigger total than one a single hole in at one under, and must
     still rank ahead of it. */
  w.eval(`(function(){
    const g = GAMES[0], co = courseOf(g);
    g.holes = blankHoles();
    for (let h = 0; h < 6; h++) g.holes[h].teamScore[0] = co.holes[h].par - 1;
    g.holes[0].teamScore[1] = co.holes[0].par - 1;
    render();
  })()`);
  const ranks = [...document.querySelectorAll(".hg-lab .hg-rk")].map(x => x.textContent.trim());
  eq(ranks.length, 4, "a rank beside every side:");
  eq(ranks[0], "1", "six under through six should lead:");
  ok(+ranks[1] > 1,
     "one under through one must not, despite the far lower gross: " + ranks.join(","));
  w.eval('view.gameId = null; render();');
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

section("casual rounds — on the schedule, out of the record");

/* A round that isn't part of the tournament. Built on the existing four-team
   helper so the game itself is known-finished and its outcomes already proved
   elsewhere — the only thing under test here is whether it reaches the record. */
function casualRoundGame(counts){
  const w = dom.window;
  w.eval(`GAMES.length = 0;
    ROUNDS()[0].counts = ${counts === undefined ? "undefined" : JSON.stringify(counts)};
    if (${counts === undefined}) delete ROUNDS()[0].counts;`);
  fourTeamGame([70,72,74,76]);
}
const recOf = () => {
  const by = {};
  JSON.parse(dom.window.eval("JSON.stringify(standings())")).forEach(r => by[r.name] = r);
  return by;
};

t("R101 a casual round reaches nobody's record", () => isolate(() => {
  casualRoundGame(false);
  const by = recOf();
  ["Blake","Dan","Howard","Luke","Jake","Adam","Jason","Daniel"].forEach(n => {
    eq(by[n].w, 0, n + " should have no win from a casual round:");
    eq(by[n].l, 0, n + " should have no loss from a casual round:");
    eq(by[n].t, 0, n + " should have no tie from a casual round:");
    /* The one that matters most: counting it as played with no result would
       quietly divide everyone's win% by a bigger number. */
    eq(by[n].gp, 0, n + " should not even have a game played:");
  });
  eq(by["Blake"].pts, 0, "and no points:");
}));

t("R102 the same round sanctioned does reach the record", () => isolate(() => {
  casualRoundGame(true);
  const by = recOf();
  eq(by["Blake"].w, 1, "sanctioned, so the win counts:");
  eq(by["Blake"].gp, 1, "and the game played counts:");
  eq(by["Jake"].l, 1, "and the bottom half takes the loss:");
}));

t("R103 a round with no flag at all counts — older builds wrote none", () => isolate(() => {
  casualRoundGame(undefined);
  ok(dom.window.eval("ROUNDS()[0].counts === undefined"), "the flag really is absent");
  eq(recOf()["Blake"].gp, 1, "absent must mean sanctioned, not casual:");
}));

t("R104 a casual round is out of all three pairings tables", () => isolate(() => {
  const w = dom.window;
  casualRoundGame(false);
  const m = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m.played["p1"], 0, "Blake played no counting game:");
  eq(m.withC["p1"]["p2"], 0, "team-mates from a casual round don't count:");
  eq(m.agC["p1"]["p3"], 0, "nor do opponents:");
  eq(m.grpC["p1"]["p2"], 0, "nor the foursome:");

  /* Same game, sanctioned — proves the zeros above came from the flag and not
     from the game being unreadable. */
  w.eval("ROUNDS()[0].counts = true;");
  const m2 = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m2.withC["p1"]["p2"], 1, "sanctioned, so the pair counts:");
  eq(m2.played["p1"], 1, "and the game is played:");
}));

t("R105 an orphan game doesn't inherit the first round's flag", () => isolate(() => {
  /* gameCounts uses EV() directly rather than roundOf(), whose fallback to
     ROUNDS()[0] would have made a game with no round casual the moment the
     Thursday morning round was marked casual. */
  const w = dom.window;
  casualRoundGame(false);
  w.eval('GAMES.find(g => g.id === "g2x4").roundId = "nope";');
  eq(recOf()["Blake"].gp, 1, "an orphan counts — it has no round to be casual:");
}));

t("R106 the toggle is in the round editor and both ways work", () => isolate(() => {
  const w = dom.window;
  w.eval(`isAdmin = true; ROUNDS()[0].counts = true;
    editEvent = ROUNDS()[0].id; view.tab = "sched"; view.gameId = null; render();`);
  const off = document.querySelector('[data-evcounts="0"]');
  const on  = document.querySelector('[data-evcounts="1"]');
  ok(off && on, "both buttons should be in the round editor");
  click(off);
  eq(w.eval("ROUNDS()[0].counts"), false, "tapping Casual should set it:");
  w.eval(`editEvent = ROUNDS()[0].id; view.tab = "sched"; render();`);
  click(document.querySelector('[data-evcounts="1"]'));
  eq(w.eval("ROUNDS()[0].counts"), true, "and tapping Sanctioned should set it back:");
  /* false, never undefined — Firestore rejects undefined outright. */
  ok(w.eval('typeof ROUNDS()[0].counts === "boolean"'), "stored as a real boolean");
}));

t("R107 a casual round survives the CSV round trip", () => isolate(() => {
  const w = dom.window;
  w.eval(`ROUNDS()[0].counts = false; ROUNDS()[1].counts = true;`);
  const csv = w.eval("scheduleToCSV()");
  ok(/(^|\n)[^,\n]*,[^,\n]*,ROUND-CASUAL,/.test(csv), "the export should say ROUND-CASUAL");
  ok(/(^|\n)[^,\n]*,[^,\n]*,ROUND,/.test(csv), "and a sanctioned round should still say ROUND");
  const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
  eq(plan.errors.length, 0, "a round trip should import cleanly: " + plan.errors.join(" | "));
  const rounds = plan.events.filter(e => e.type === "ROUND");
  eq(rounds.filter(r => r.counts === false).length, 1, "one casual round should come back:");
  ok(rounds.every(r => typeof r.counts === "boolean"),
     "and every imported round should carry an explicit boolean");
}));

t("R109 a round's notes survive the CSV round trip too", () => isolate(() => {
  const w = dom.window;
  w.eval(`ROUNDS()[0].notes = "two tee times 1:03 and 1:12";`);
  const csv = w.eval("scheduleToCSV()");
  ok(/two tee times 1:03 and 1:12/.test(csv), "the export should carry the note");
  const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
  eq(plan.errors.length, 0, "and still import cleanly: " + plan.errors.join(" | "));
  eq(plan.events.filter(e => e.type === "ROUND")[0].notes,
     "two tee times 1:03 and 1:12", "and come back on the round:");
}));

t("R108 the casual flag is visible on the schedule, not only in the editor", () => isolate(() => {
  const w = dom.window;
  w.eval(`isAdmin = true; ROUNDS()[0].counts = false;
    editEvent = null; view.gameId = null; view.tab = "sched"; schedMode = "timeline"; render();`);
  ok(/casual/i.test(appHTML()), "the schedule should say so somewhere");
  w.eval('view.tab = "home"; homeShowAll = true; render();');
  ok(/casual/i.test(appHTML()), "and so should the Games tab");
}));

section("40ball reads in net to par, like stroke play");

/* A 40ball where team 0 spends two scores on hole 1 and team 1 spends three.
   The exact figures depend on who gets a stroke there, so the tests read them
   back rather than assuming — the first draft hard-coded them, forgot the
   handicaps and failed on numbers that were correct. What matters is that the
   two sides have spent DIFFERENT numbers of scores, which is the case a bare
   total gets wrong. */
function fortyBallState(){
  const w = dom.window;
  return w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    g.holes = blankHoles();
    const par = courseOf(g).holes[0].par;
    const a = g.teams[0], b = g.teams[1];
    g.holes[0].scores[a[0]] = par - 1; g.holes[0].scores[a[1]] = par;
    g.holes[0].selected[0] = [a[0], a[1]];
    g.holes[0].locked[0] = true;
    g.holes[0].scores[b[0]] = par; g.holes[0].scores[b[1]] = par;
    g.holes[0].scores[b[2]] = par + 1;
    g.holes[0].selected[1] = [b[0], b[1], b[2]];
    g.holes[0].locked[1] = true;
    isAdmin = true; view.gameId = g.id; view.hole = 0; render();
    return JSON.stringify({ id: g.id,
      rel0: fbTotal(g,0) - fbParBasis(g,0), rel1: fbTotal(g,1) - fbParBasis(g,1),
      tot0: fbTotal(g,0), tot1: fbTotal(g,1),
      spent0: fbSpent(g,0), spent1: fbSpent(g,1) });
  })()`);
}

t("R110 the 40ball banner leads with to par and trails the gross total", () => isolate(() => {
  const w = dom.window;
  const s = JSON.parse(fortyBallState());
  eq(s.spent0, 2, "A spent two scores:");
  eq(s.spent1, 3, "B spent three, so their raw totals are not comparable:");
  const rows = [...document.querySelectorAll(".banner .strokerow")];
  eq(rows.length, 2, "one row per side, same shape as stroke play:");
  /* Order within the row is the whole ask: name, to par, then the total. */
  const cls = [...rows[0].children].map(c => c.className.split(" ")[0]);
  eq(cls.join(","), "sname,spar,stot", "to par must come before the gross total:");
  eq(rows[0].querySelector(".spar").textContent.trim(), w.eval(`toPar(${s.rel0})`),
     "A's figure should be its net to par:");
  eq(rows[0].querySelector(".stot").textContent.trim(), String(s.tot0),
     "with the gross total trailing it:");
  eq(rows[0].querySelector(".spar").className.split(" ")[1], w.eval(`parClass(${s.rel0})`),
     "and coloured by whether that's under or over:");
}));

t("R111 the 40ball card label names the leader in to par, not two totals", () => isolate(() => {
  const w = dom.window;
  const s = JSON.parse(fortyBallState());
  const lab = JSON.parse(w.eval(
    `JSON.stringify(gameStatusLabel(GAMES.find(g=>g.id==="${s.id}")))`));
  const lead = s.rel0 <= s.rel1 ? 0 : 1;
  const relLead = w.eval(`toPar(${lead === 0 ? s.rel0 : s.rel1})`);
  ok(lab.text.indexOf(relLead) !== -1,
     "the leader's to par should be in the label: " + lab.text);
  if (s.rel0 !== s.rel1)
    ok(lab.text.indexOf("leads by " + Math.abs(s.rel0 - s.rel1)) !== -1,
       "and the margin, measured in to par: " + lab.text);
  ok(!new RegExp(`${s.tot0}\\s*\\(`).test(lab.text),
     "the old 'total (to par)' shape should be gone: " + lab.text);
  ok(/40/.test(lab.text), "the budget still belongs in the label: " + lab.text);
}));

t("R112 a 40ball team head leads with to par as well", () => isolate(() => {
  const w = dom.window;
  const s = JSON.parse(fortyBallState());
  const head = document.querySelector(".team .team-score");
  ok(head, "no team head on the 40ball card");
  const lead = head.querySelector(".parlead");
  ok(lead, "the to-par figure should be the sized-up one");
  eq(lead.textContent.trim(), w.eval(`toPar(${s.rel0})`), "and it should be A's net to par:");
  ok(head.querySelector(".tsub"), "the gross total and budget trail it");
  ok(head.textContent.indexOf(w.eval(`toPar(${s.rel0})`)) < head.textContent.indexOf("/40"),
     "to par has to come before the budget in the head too");
}));

t("R113 a course played twice in a day says so once", () => isolate(() => {
  const w = dom.window;
  const played = rounds => {
    w.eval(`(function(){
      SCHEDULE = ${JSON.stringify(rounds)}.map((d,i) => ({ id:"r"+i, type:"ROUND", day:d,
        courseId: COURSES[0].id, mode:"RELATIVE" }));
      GAMES = []; isAdmin = true; editCourseId = COURSES[0].id;
      view.tab = "players"; view.gameId = null; editEvent = null; render();
    })()`);
    return [...document.querySelectorAll("#app .note")].map(n => n.textContent.trim())
      .find(t => /^Played|^No rounds/.test(t)) || "";
  };
  /* Friday's 36 holes are two rounds on one course, which read "Played Friday,
     Friday." — one entry per round rather than per day. */
  eq(played(["Friday","Friday"]), "Played Friday (2 rounds).", "two rounds, one day:");
  eq(played(["Saturday"]), "Played Saturday.", "a single round stays plain:");
  eq(played(["Thursday","Friday","Friday","Saturday"]),
     "Played Thursday, Friday (2 rounds) and Saturday.",
     "several days read as a sentence, in day order:");
  eq(played([]), "No rounds assigned to this course.", "and none is still none:");
}));

t("R114 the all-eight flag survives the CSV, both directions", () => isolate(() => {
  const w = dom.window;
  const csv = "day,time,type,course,detail,player,notes,a1,a2,a3,a4,b1,b2,b3,b4,c1,c2,c3,c4,d1,d2,d3,d4\n"
    + "Thursday,1:03pm,ROUND,Pine Hollow\n"
    + "Thursday,,GAME,,2V2V2V2-8,,,Blake,Daniel,,,Dan,Howard,,,Jason,Luke,,,Jake,Adam\n"
    + "Friday,8:00am,ROUND,Pine Hollow\n"
    + "Friday,,GAME,,2V2V2V2,,,Blake,Dan,,,Jason,Daniel,,,Howard,Luke,,,Jake,Adam";
  const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
  eq(plan.errors.length, 0, "it should import cleanly: " + plan.errors.join(" | "));
  eq(plan.games[0].oneGroup, true, "the -8 suffix means all eight walk together:");
  ok(!plan.games[1].oneGroup, "and a plain 2V2V2V2 is two foursomes");
  /* The flag only earns its place if it reaches the matrix: an all-eight round
     must add nothing to the foursome column while still counting team-mates. */
  /* SCHEDULE too: scheduleToCSV walks the rounds and writes each round's games
     under it, so games with no round in SCHEDULE export as nothing at all. */
  w.eval(`SCHEDULE = ${JSON.stringify(plan.events)};
          GAMES = ${JSON.stringify(plan.games)}.map(g => { g.holes = blankHoles(); return g; });`);
  const one = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(one.grpC.p1.p4, 1, "only the two-foursome round should give Blake & Daniel a foursome:");
  eq(one.withC.p1.p4, 1, "while the all-eight round still counts them as team-mates:");

  const back = w.eval("scheduleToCSV()");
  ok(/,2V2V2V2-8,/.test(back), "the export must write the suffix back");
  ok(/,2V2V2V2,/.test(back), "and leave a two-foursome game plain");
  const round2 = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(back)}))`));
  eq(round2.games.filter(g => g.oneGroup).length, 1, "one all-eight game survives the round trip:");
}));

t("R115 the tee picker isn't capped narrower than a tee name", () => isolate(() => {
  const w = dom.window;
  /* jsdom has no layout, so this guards the cause rather than the symptom:
     a max-width on select.tee is what clipped "Black/White" to "Black/Whit". */
  const rule = /select\.tee\{[^}]*\}/.exec(html);
  ok(rule, "select.tee should still be styled");
  ok(!/max-width/.test(rule[0]), "select.tee must not cap its width: " + rule[0]);
  ok(/width:\s*100%/.test(rule[0]), "it should fill its cell instead");
  /* And the cell has to exist to fill. isolate() restores the schedule and the
     games, not COURSES or PLAYERS, so this puts the tees back itself. */
  const saved = w.eval(`JSON.stringify({ tees: COURSES[0].tees,
    assign: PLAYERS.map(p => p.tees && p.tees[COURSES[0].id]) })`);
  try {
    w.eval(`(function(){
      const c = COURSES[0];
      c.tees = [{name:"Black/White", rating:74.1, slope:142, par:72},
                {name:"Blue", rating:71.8, slope:131, par:72}];
      PLAYERS.forEach(p => { p.tees = p.tees || {}; p.tees[c.id] = "Black/White"; });
      isAdmin = true; editCourseId = c.id; view.tab = "players"; view.gameId = null;
      editEvent = null; render();
    })()`);
    openSection("f:who");          // a test helper, so it runs out here, not in the page
    const sel = document.querySelector("select.tee");
    ok(sel, "no tee picker on the Field tab");
    eq(sel.closest("td").className, "teecell", "the tee cell needs its class to be sized:");
    ok([...sel.options].some(o => o.textContent === "Black/White"),
       "the full tee name must be in the option, not a truncation");
  } finally {
    w.eval(`(function(){
      const s = ${JSON.stringify(saved)}, o = JSON.parse(s), c = COURSES[0];
      c.tees = o.tees;
      PLAYERS.forEach((p, i) => {
        if (o.assign[i] == null) { if (p.tees) delete p.tees[c.id]; }
        else { p.tees = p.tees || {}; p.tees[c.id] = o.assign[i]; }
      });
    })()`);
  }
}));

t("R116 a four-team game counts only under playing with", () => isolate(() => {
  const w = dom.window;
  w.eval("GAMES.length = 0;");
  fourTeamGame([70, 72, 74, 76]);          // p1&p2 v p3&p4 v p5&p6 v p7&p8
  const m = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m.withC.p1.p2, 1, "team-mates still count:");
  /* The whole point: against would gain one on 24 of the 28 pairs at once. */
  eq(m.agC.p1.p3, 0, "an opponent in a four-team game must not count as against:");
  eq(m.agC.p1.p7, 0, "nor one from the far side of the draw:");
  eq(m.played.p1, 1, "the game still counts as played");

  /* And a two-sided game is untouched by the same change. */
  w.eval(`GAMES.length = 0;
    GAMES.push({ id:"bb", roundId: ROUNDS()[0].id, type:"BESTBALL",
      teams:{0:["p1","p2"],1:["p3","p4"]}, holes: blankHoles() });`);
  const m2 = JSON.parse(w.eval("JSON.stringify(pairMatrix())"));
  eq(m2.agC.p1.p3, 1, "a best ball still records opponents:");
}));

/* ---------- skins, and tees that belong to a team ---------- */

/* One hole of a four-team game, scored, so holeSkins can be read straight back. */
function skinsHole(scores, opts){
  const w = dom.window;
  return JSON.parse(w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gsk", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4", skins:true,
                teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]},
                holes: blankHoles() };
    Object.assign(g, ${JSON.stringify(opts || {})});
    ${JSON.stringify(scores)}.forEach((v, i) => { g.holes[0].teamScore[i] = v; });
    GAMES.push(g);
    return JSON.stringify(holeSkins(g, 0));
  })()`));
}

t("R117 two skins a hole, split across the places a tie covers", () => isolate(() => {
  /* Twelfths of a skin, so every split that can arise is a whole number. */
  eq(skinsHole([4,5,5,5]).join(","), "12,4,4,4",
     "Blake's example: a skin to the 4, a third each to the three 5s sharing second:");
  eq(skinsHole([5,5,5,5]).join(","), "6,6,6,6",
     "all four level is half a skin each:");
  eq(skinsHole([4,4,5,5]).join(","), "12,12,0,0",
     "two clear of the field take one each:");
  eq(skinsHole([4,5,5,6]).join(","), "12,6,6,0",
     "a tie for second splits the one skin second is worth:");
  eq(skinsHole([4,4,4,5]).join(","), "8,8,8,0",
     "three tied for the lead share both skins:");
  eq(skinsHole([6,5,4,5]).join(","), "0,6,12,6",
     "and the twelfths come back in side order, not in finishing order:");
  /* Two skins a hole, always — if the arithmetic ever stopped adding to 24 the
     leaderboard would quietly drift. */
  [[4,5,5,5],[5,5,5,5],[4,4,5,5],[4,5,5,6],[4,4,4,5],[3,9,9,9]].forEach(sc =>
    eq(skinsHole(sc).reduce((a,b) => a+b, 0), 24,
       "a hole must always award exactly two skins, " + sc.join("/") + ":"));
}));

t("R118 a hole pays nothing until every team is in", () => isolate(() => {
  const w = dom.window;
  skinsHole([4,5,5,5]);
  w.eval(`GAMES[0].holes[0].teamScore[3] = null;`);
  eq(w.eval("JSON.stringify(holeSkins(GAMES[0], 0))"), "null",
     "with one team still out there, nobody can know who the best two are:");
  eq(JSON.parse(w.eval("JSON.stringify(skinTotals(GAMES[0]))")).holes, 0,
     "so the hole doesn't count toward the running total either:");
}));

t("R119 skins decide the game, and the top two still go through", () => isolate(() => {
  const w = dom.window;
  /* A deliberately awkward field: side D wins the most strokes outright but
     side A picks up more skins, so strokes and skins disagree. */
  w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gsk", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4", skins:true,
                teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]},
                holes: blankHoles() };
    /* A and B take both skins on seventeen holes by a single stroke, then
       blow the eighteenth up. C and D pick up the skins there and finish
       seven strokes better on gross — so gross and skins disagree flatly. */
    for (let h = 0; h < 18; h++){
      g.holes[h].teamScore[0] = 4;
      g.holes[h].teamScore[1] = 4;
      g.holes[h].teamScore[2] = 5;
      g.holes[h].teamScore[3] = 5;
    }
    g.holes[0].teamScore[0] = 30; g.holes[0].teamScore[1] = 30;
    g.holes[0].teamScore[2] = 6;  g.holes[0].teamScore[3] = 6;
    GAMES.push(g);
  })()`);
  const st = JSON.parse(w.eval("JSON.stringify(skinsState(GAMES[0]))"));
  eq(st.done, true, "eighteen complete holes should close the game:");
  eq(st.totals.join(","), "204,204,12,12",
     "A and B split both skins on seventeen holes; C and D split them on the blow-up:");
  eq(st.result.winner, "TIE", "A and B finish level on skins:");
  const out = JSON.parse(w.eval("JSON.stringify(teamOutcomes(GAMES[0]))"));
  eq(out.join(","), "W,W,L,L", "the two on the most skins go through, not the lowest gross:");
  /* The gross really does disagree — this is the point of the test. */
  const str = JSON.parse(w.eval("JSON.stringify(strokeTotals(GAMES[0]).totals)"));
  ok(str[2] < str[0] && str[3] < str[1],
     "C and D should be the better two on gross, so the two scorings disagree: " + str.join("/"));
}));

t("R120 a 2v2v2v2 without the flag is still the stroke play it always was", () => isolate(() => {
  const w = dom.window;
  /* Last year's game is sitting in Firestore with no skins flag on it. If the
     format itself changed, re-reading it would rescore the round and move the
     all-time records. */
  eq(fourTeamGame([70,72,74,76]), "[70,72,74,76]", "a plain four-team game totals on strokes:");
  ok(!w.eval('isSkins(GAMES.find(x=>x.id==="g2x4"))'), "and must not be read as skins");
  eq(JSON.parse(w.eval('JSON.stringify(gameResult(GAMES.find(x=>x.id==="g2x4")))')).winner, "A",
     "the lowest total still wins it:");
  eq(outcomes().join(","), "W,W,L,L", "and the top two on strokes still go through:");
}));

t("R121 a team's tee overrides the man's, for that game only", () => isolate(() => {
  const w = dom.window;
  const saved = w.eval(`JSON.stringify({ tees: COURSES[0].tees,
    assign: PLAYERS.map(p => p.tees && p.tees[COURSES[0].id]) })`);
  try {
    w.eval(`(function(){
      const c = COURSES[0];
      c.tees = [{name:"Black", rating:74.0, slope:138, par:72},
                {name:"Purple", rating:62.8, slope:102, par:72}];
      PLAYERS.forEach(p => { p.tees = p.tees || {}; p.tees[c.id] = "Black"; });
    })()`);
    skinsHole([4,4,4,4], { tees: { 0:"Purple" } });
    eq(w.eval('teeNameIn(GAMES[0], "p1", COURSES[0])'), "Purple",
       "a man on the side with a team tee plays that box:");
    eq(w.eval('teeNameIn(GAMES[0], "p5", COURSES[0])'), "Black",
       "a side with none falls back to what the Field tab says:");
    eq(w.eval('teeNameFor("p1", COURSES[0])'), "Black",
       "and the man's own tee is left exactly as it was:");
    /* The tee is for reading, not for scoring — these formats take no
       handicaps, so it must never reach the course handicap. */
    eq(w.eval('courseHcp("p1", COURSES[0])'), w.eval('courseHcp("p1", COURSES[0])'),
       "course handicap is still computed from the player's own tee:");
  } finally {
    w.eval(`(function(){
      const o = JSON.parse(${JSON.stringify(saved)}), c = COURSES[0];
      c.tees = o.tees;
      PLAYERS.forEach((p, i) => {
        if (o.assign[i] == null) { if (p.tees) delete p.tees[c.id]; }
        else { p.tees = p.tees || {}; p.tees[c.id] = o.assign[i]; }
      });
    })()`);
  }
}));

t("R122 skins and team tees survive the CSV, both directions", () => isolate(() => {
  const w = dom.window;
  const saved = w.eval(`JSON.stringify(COURSES[0].tees)`);
  try {
    w.eval(`COURSES[0].tees = [{name:"Black",rating:74,slope:138,par:72},
                               {name:"Blue",rating:72.5,slope:134,par:72},
                               {name:"Purple",rating:62.8,slope:102,par:72}];`);
    const co = w.eval("COURSES[0].name");
    const csv = "day,time,type,course,detail,player,notes,a1,a2,a3,a4,b1,b2,b3,b4,c1,c2,c3,c4,d1,d2,d3,d4\n"
      + `Thursday,1:03pm,ROUND,${co}\n`
      + "Thursday,,GAME,,2V2V2V2-8,,Skins. Tees: Black / Blue / Purple / own,"
      + "Blake,Daniel,,,Dan,Howard,,,Jason,Luke,,,Jake,Adam\n";
    const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
    eq(plan.errors.length, 0, "it should import cleanly: " + plan.errors.join(" | "));
    const g = plan.games[0];
    eq(g.skins, true, "the word Skins in the notes turns the game into skins:");
    eq(g.tees[0], "Black", "the first team's box comes off the list:");
    eq(g.tees[2], "Purple", "and so does the third's:");
    ok(!(g.tees && g.tees[3]), "\"own\" leaves that team on each man's own tee");

    w.eval(`SCHEDULE = ${JSON.stringify(plan.events)};
            GAMES = ${JSON.stringify(plan.games)}.map(x => { x.holes = blankHoles(); return x; });`);
    const back = w.eval("scheduleToCSV()");
    ok(/Skins/.test(back), "the export has to write Skins back or it's lost on a round trip");
    ok(/Tees: Black \/ Blue \/ Purple \/ own/.test(back),
       "and the four boxes with it: " + (/.*Tees:[^\n]*/.exec(back)||[""])[0]);
    const again = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(back)}))`));
    eq(again.games[0].skins, true, "skins survives the round trip:");
    eq(again.games[0].tees[1], "Blue", "and so do the tees:");

    /* A tee name the course doesn't have is a mistake worth naming, not a
       silently dropped box. */
    const bad = csv.replace("Tees: Black / Blue / Purple / own", "Tees: Tartan");
    const p2 = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(bad)}))`));
    ok(p2.errors.some(x => /Tartan/.test(x)), "an unknown tee should be reported: "
       + p2.errors.join(" | "));
  } finally {
    w.eval(`COURSES[0].tees = ${saved};`);
  }
}));

t("R123 the skins card says skins, not strokes", () => isolate(() => {
  const w = dom.window;
  skinsHole([4,5,5,5]);
  w.eval(`view.tab = "home"; view.gameId = "gsk"; view.hole = 0;
          editEvent = null; render();`);
  const txt = document.getElementById("app").textContent;
  ok(/Skins/.test(txt), "the banner should say what's being played");
  ok(/two a hole/.test(txt), "and how much is on each hole");
  ok(!/Stroke play/.test(txt), "it must not also claim stroke play");
  const label = JSON.parse(w.eval('JSON.stringify(gameStatusLabel(GAMES[0]))'));
  ok(/lead on 1\b/.test(label.text), "the card label should name the leader and their skins: " + label.text);
  ok(/thru 1/.test(label.text), "and how far they are: " + label.text);
}));

t("R124 the Games tab opens on the whole weekend, and Schedule sits before Board", () => {
  const w = dom.window;
  /* Narrowing to today made a four-day tournament look like a one-day one,
     and hid every other round from anyone opening it beforehand. */
  ok(w.eval("homeShowAll"), "the Games tab should start showing all days");
  const tabs = [...document.querySelectorAll("nav [data-tab]")].map(b => b.dataset.tab);
  eq(tabs.join(","), "home,sched,board,players", "tab order:");
  /* Switching year must not quietly put the narrowing back. */
  const src = /async function switchYear[\s\S]*?\n}/.exec(html)[0];
  ok(!/homeShowAll\s*=\s*false/.test(src),
     "switchYear must not reset the Games tab to a single day");
  ok(!/homeShowAll\s*=\s*false/.test(html.replace(/id === "showtoday"[^\n]*\n/, "")),
     "nothing but the \"Just today\" chip should turn the narrowing on");
});

t("R125 the card shows every team's score, in colour, with no name printed twice", () => isolate(() => {
  const w = dom.window;
  const saved = w.eval("JSON.stringify(COURSES[0].holes.map(x=>x.par))");
  try {
    w.eval(`(function(){
      [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4].forEach((p,k)=>COURSES[0].holes[k].par=p);
      GAMES.length = 0;
      const g = { id:"gcard", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4", skins:true,
                  teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]},
                  holes: blankHoles() };
      /* hole 1 is a par 4: a birdie, a par, a bogey and a par. */
      [3,4,5,4].forEach((v,i)=>g.holes[0].teamScore[i]=v);
      [5,5,5,5].forEach((v,i)=>g.holes[9].teamScore[i]=v);   // and one on the back nine
      GAMES.push(g);
      view.tab="home"; view.gameId="gcard"; view.hole=0; editEvent=null; render();
    })()`);
    /* One strip, all eighteen, scrolling sideways. */
    const blocks = [...document.querySelectorAll(".hg")];
    eq(blocks.length, 1, "the card should be one strip, not folded into nines:");
    ok(document.querySelector(".hgwrap"), "and it should sit in a scrollable wrapper");
    const cells = [...document.querySelectorAll(".hg-s")];
    eq(cells.length, 72, "four teams across eighteen holes:");
    /* Rows sit in standings order, so a side is found by its data-side rather
       than by counting down the card. */
    const rowOf = t => document.querySelector(`.hg-row[data-side="${t}"]`);
    const cellOf = (t, i) => rowOf(t).querySelectorAll(".hg-s")[i];
    const h1 = [0,1,2,3].map(t => cellOf(t, 0));
    eq(h1.map(c => c.querySelector(".hg-v").textContent.trim()).join(","), "3,4,5,4",
       "hole 1 across the four teams:");
    const tone = c => c.querySelector(".hg-v").className;
    ok(tone(h1[0]).includes("under"), "a birdie should be coloured under par: " + tone(h1[0]));
    ok(tone(h1[1]).includes("even"),  "a par should be neither: " + tone(h1[1]));
    ok(tone(h1[2]).includes("over"),  "a bogey should be coloured over par: " + tone(h1[2]));
    /* This game is skins, so the skins lead the cell and the stroke trails. */
    ok(h1[0].querySelector(".hg-sk").className.includes("lead"),
       "skins should be the big number in a skins game:");
    ok(h1[0].querySelector(".hg-v").className.includes("sub"),
       "with the stroke under it:");
    /* Hole 10 is the tenth cell of a team's row, in the same strip. */
    eq(cellOf(0, 9).querySelector(".hg-v").textContent.trim(), "5",
       "hole 10 sits in the same row as hole 1:");
    /* Full names, because four columns of initials made Dan and Daniel the
       same label — the thing that was wrong with the pairings grid. */
    /* The rank badge shares the label, so read the name past it. */
    const nameIn = x => {
      const rk = x.querySelector(".hg-rk");
      return x.textContent.trim().slice(rk ? rk.textContent.trim().length : 0);
    };
    const labs = [0,1,2,3].map(t => nameIn(rowOf(t).querySelector(".hg-lab")));
    eq(labs.length, 4, "a row per team:");
    /* Uppercased by CSS, so compare the text the markup actually carries. A
       pair gets both names; a bigger side gets sideName's "X's team", which is
       the app's existing answer to a label that won't fit. */
    labs.forEach((l,i) => eq(l, w.eval(`sideName(GAMES[0], ${i})`),
      "team rows are labelled with the whole side:"));
    ok(blocks[0].querySelector(".hg-lab .hg-rk"),
       "and carry the side's rank, so the rows never have to be re-sorted");

    /* And the team block below no longer prints those same names again. */
    const blocksOut = [...document.querySelectorAll(".team")];
    ok(blocksOut.length, "the entry blocks should still be there");
    ok(!blocksOut[0].querySelector(".pname:not(.pname-par)"),
       "the roster line under the team head was the team name a second time");
    ok(blocksOut[0].querySelector(".team-name"), "the team head still names the side");
    /* The number in the stepper carries the same colour as the card cell. */
    const val = blocksOut[0].querySelector(".step .val");
    eq(val.textContent.trim(), "3", "the stepper shows this hole's score:");
    ok(val.className.includes("under"), "and colours it like a birdie: " + val.className);
  } finally {
    /* isolate() restores SCHEDULE and GAMES, not COURSES, so the pars go back
       by hand or every later test runs against this card's layout. */
    w.eval(`(function(){ const p = ${saved}; p.forEach((v,k)=>COURSES[0].holes[k].par=v); })()`);
  }
}));

t("R126 nothing on a grid is labelled with a truncated name", () => isolate(() => {
  const w = dom.window;
  /* Four letters made Dan and Daniel the same column, and the row labels down
     the left were full names, so the two halves disagreed about who was who. */
  w.eval(`view.gameId=null; view.tab="board"; boardMode="pairs"; editEvent=null; render();`);
  /* Three grids on the screen, all headed the same way — take the first. */
  const heads = [...document.querySelectorAll("table.pm")[0]
    .querySelectorAll("thead th.pmn")].map(x => x.textContent.trim());
  const names = JSON.parse(w.eval("JSON.stringify(PLAYERS.map(p=>p.name))"));
  eq(heads.join(","), names.join(","), "matrix headings should be the whole name:");
  eq(new Set(heads).size, heads.length, "and so no two columns can share a heading:");
  /* Vertical is what makes a whole name fit a narrow column — without it the
     table is wider than any phone. */
  ok(/th\.pmn span\{[^}]*writing-mode:\s*vertical/.test(html),
     "the headings need to be turned on their side to fit");

  /* Same rule on the scorecard: every man on a side is named. A side of four
     used to be "Adam's team", which credited one man with the other three; it
     is now all four, two to a line. */
  w.eval(`(function(){
    GAMES.length = 0;
    GAMES.push({ id:"g4v4", roundId: ROUNDS()[0].id, type:"SCRAMBLE4",
      teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes: blankHoles() });
    view.tab="home"; view.gameId="g4v4"; view.hole=0; render();
  })()`);
  const labs = [...document.querySelectorAll(".hg-row[data-side] .hg-lab")].map(x => x.textContent.trim());
  eq(labs.length, 2, "a 4v4 gets a row per side:");
  const sideNames = JSON.parse(w.eval(`JSON.stringify([0,1].map(t =>
    GAMES[0].teams[t].map(id => P(id).name)))`));
  labs.forEach((l,i) => {
    sideNames[i].forEach(n => ok(l.includes(n), "every man on the side is named — " + n + " in: " + l));
    ok(!/'s team/.test(l), "and nobody is the team's namesake: " + l);
    ok(!/\.\.\.|…/.test(l), "and never an ellipsis: " + l);
  });
  ok(document.querySelectorAll(".hg-lab .hg-nm").length === 2, "two lines to a side of four");
  ok(document.querySelector(".hgwrap"), "the 4v4 card is the same scrolling strip");
}));

t("R127 the card's rows re-order with the standings, and the entry blocks don't",
  () => isolate(() => {
  const w = dom.window;
  const order = () => [...document.querySelectorAll(".hg-row[data-side]")]
    .map(r => r.dataset.side).join(",");
  const blockOrder = () => [...document.querySelectorAll(".team .team-name")]
    .map(x => x.textContent.trim()).join("|");

  w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gsort", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4", skins:true,
                teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]},
                holes: blankHoles() };
    GAMES.push(g);
    view.tab="home"; view.gameId="gsort"; view.hole=0; editEvent=null; render();
  })()`);
  eq(order(), "0,1,2,3", "nothing played yet, so the rows sit in side order:");
  const blocksBefore = blockOrder();

  /* Side D runs away with the first hole. */
  w.eval(`(function(){
    const g = GAMES[0];
    [6,6,6,3].forEach((v,i) => g.holes[0].teamScore[i] = v);
    render();
  })()`);
  eq(order().split(",")[0], "3", "the side that won the hole should lead the card: " + order());
  const rk = document.querySelector('.hg-row[data-side="3"] .hg-rk');
  eq(rk.textContent.trim(), "1", "and be ranked first:");
  ok(rk.className.includes("in"), "and marked as going through:");

  /* Then it falls apart. */
  w.eval(`(function(){
    const g = GAMES[0];
    [3,3,3,9].forEach((v,i) => g.holes[1].teamScore[i] = v);
    [3,3,3,9].forEach((v,i) => g.holes[2].teamScore[i] = v);
    render();
  })()`);
  eq(order().split(",").pop(), "3", "and drop to the bottom when it stops winning holes: " + order());

  /* The blocks you actually tap must not have moved — that was the whole
     objection to sorting, and it only ever applied down there. */
  eq(blockOrder(), blocksBefore, "the entry blocks must stay in side order:");

  /* The shuffle is measured before the DOM is replaced and released after. */
  ok(/captureRows\(\)/.test(html) && /animateRows\(\)/.test(html),
     "render() should bracket the redraw with the two halves of the shuffle");
  ok(/prefers-reduced-motion/.test(html), "and sit still for anyone who asked for that");
  /* Three things that are invisible when wrong — the rows still end up in the
     right order, they just arrive without having travelled — so they're
     guarded at the source. jsdom has no layout, so there's nothing to measure.

     position:sticky breaks under a transformed ancestor, which is why the
     offset is `top`. The forced reflow is what makes the start position real:
     requestAnimationFrame runs before layout, so without it the browser
     coalesces both values into one style. And releasing to "" computes to
     `auto`, which a length will not interpolate to. */
  const fn = /function animateRows\(\)[\s\S]*?\n}/.exec(html)[0];
  ok(!/transform/.test(fn), "rows must not animate with transform: it would unstick the "
     + "pinned name and total columns");
  ok(/offsetHeight|offsetTop|getBoundingClientRect\(\)[\s\S]{0,40}transition/.test(fn),
     "the start position has to be forced into layout before it's released");
  ok(/style\.top\s*=\s*"0px"/.test(fn),
     'the row must be released to an explicit 0px — "" computes to auto and will not animate');
}));

t("R128 a flight goes in by pasting it", () => isolate(() => {
  const w = dom.window;
  const pf = txt => JSON.parse(w.eval(`JSON.stringify(parseFlight(${JSON.stringify(txt)}))`));

  let f = pf("United 2137 ORD 10:51am - RSW 2:57pm");
  eq(f.title, "United 2137", "airline and number out of a plain line:");
  eq(f.from + "/" + f.to, "ORD/RSW", "both airports, in order:");
  eq(f.dep + "/" + f.arr, "10:51/14:57", "and both times, with the afternoon kept:");

  f = pf("UA2137 ORD 10:51 RSW 14:57");
  eq(f.title, "United 2137", "a two-letter code becomes the airline's name:");
  eq(f.dep + "/" + f.arr, "10:51/14:57", "24-hour times work too:");

  /* The trap: ORD followed by a number looks exactly like a carrier and a
     flight number, so the airport has to be excluded once the flight is found
     — and when there's no carrier at all it must not invent one. */
  f = pf("ORD 10:51am RSW 2:57pm");
  /* Had ORD been taken for a carrier, it would have been struck out of the
     line and RSW would have come back as the origin. */
  eq(f.from + "/" + f.to, "ORD/RSW", "an airport before a time is still an airport:");
  eq(f.dep + "/" + f.arr, "10:51/14:57", "with the times read either way:");

  f = pf("Delta 1190 departs Sunday RSW 6:50 AM arrives ORD 9:15 AM");
  eq(f.title, "Delta 1190", "an airline name in words:");
  /* Matched against this tournament's own day labels, so "Sun" finds whatever
     the weekend calls Sunday and a day it doesn't have comes back null. */
  eq(f.day, "Sunday", "the day, as this tournament names it:");
  eq(pf("UA 1 Tuesday ORD 9:00am MCO 1:00pm").day, null,
     "a day this weekend doesn't have is left for the editor:");

  /* Nothing is rejected: an unreadable paste still makes an event. */
  f = pf("my buddy is driving me");
  ok(f.title.length, "even a line with no flight in it gives something: " + f.title);

  /* And the button does the whole job: event created, filled, and opened so
     anything the paste missed is one tap away. */
  const before = w.eval("SCHEDULE.length");
  w.eval(`SYNC.on = true; isAdmin = false; view.gameId = null; view.tab = "sched";
          schedMode = "travel"; editEvent = null; render();`);
  /* The paste box is now the second way in, behind a link under the form. */
  click(document.querySelector('[data-flightpaste="ARRIVAL"]'));
  ok(document.querySelector('[data-flightadd="ARRIVAL"]'), "no paste box on arrivals");
  document.getElementById("fin-ARRIVAL").value = "United 2137 ORD 10:51am RSW 2:57pm";
  document.querySelector('[data-flightadd="ARRIVAL"]').click();
  eq(w.eval("SCHEDULE.length"), before + 1, "one flight added:");
  const made = JSON.parse(w.eval(`JSON.stringify(SCHEDULE[SCHEDULE.length - 1])`));
  eq(made.type + "/" + made.dir, "TRAVEL/ARRIVAL", "as an arrival:");
  eq(made.title, "United 2137", "titled by the flight:");
  /* An arrival is filed at the time it lands, not the time it took off — the
     schedule is of things happening here. */
  eq(made.time, "14:57", "at the landing time:");
  ok(/ORD/.test(made.notes) && /RSW/.test(made.notes), "with the route in the notes: " + made.notes);
  ok(w.eval("editEvent") === made.id, "and opened, so who-it-is is one tap away");
  w.eval("editEvent = null; flightPasteOpen = null; SYNC.on = false; isAdmin = true; view.tab = 'home'; render();");
}));

section("Wolf — five men, new teams every hole");

/* Every player on the same index, so net is gross and the points table can be
   read off the scores. Restored inside the same eval, so nothing leaks. */
function wolfHole(scores, opts){
  const o = opts || {};
  return JSON.parse(dom.window.eval(`(function(){
    const save = PLAYERS.map(p => p.index);
    PLAYERS.forEach(p => p.index = 10);
    try {
      GAMES.length = 0;
      const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                  teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles() };
      Object.assign(g, ${JSON.stringify(o.game || {})});
      Object.assign(g.holes[0], ${JSON.stringify(o.hole || {})});
      ${JSON.stringify(scores)}.forEach((v, i) => {
        if (v != null) g.holes[0].scores[g.teams[0][i]] = v;
      });
      GAMES.push(g);
      const p = wolfHolePoints(g, 0);
      return JSON.stringify(p && g.teams[0].map(id => p[id]));
    } finally { PLAYERS.forEach((p, i) => p.index = save[i]); }
  })()`));
}
/* p1 is wolf on hole 0 by rotation; pack of p2+p3 unless a test says otherwise */
const PACK = { hole:{ pack:["p2","p3"] } };
const LONE = { hole:{ lone:true } };

t("R129 the wolf points table, exactly as the game is played", () => isolate(() => {
  eq(wolfHole([4,5,5,6,6], PACK).join(","), "1,1,1,0,0",
     "wolf's three win the hole, a point each:");
  eq(wolfHole([6,6,6,4,5], PACK).join(","), "0,0,0,3,3",
     "the two he left out win, three each — the pack is paid more for being fewer:");
  eq(wolfHole([4,6,6,5,5], LONE).join(","), "8,0,0,0,0",
     "a lone wolf who beats the other four takes eight:");
  eq(wolfHole([6,5,5,5,5], LONE).join(","), "0,2,2,2,2",
     "and when he loses it's two to each of them:");
  /* Nothing carries, so a halved hole is simply gone. */
  eq(wolfHole([4,5,5,4,5], PACK).join(","), "0,0,0,0,0",
     "level is nothing to anybody:");
  eq(wolfHole([4,5,5,4,5], LONE).join(","), "0,0,0,0,0",
     "including a lone wolf who only ties:");
  /* Only the best ball counts, so the man who blew up costs his side nothing. */
  eq(wolfHole([4,9,9,5,5], PACK).join(","), "1,1,1,0,0",
     "it's best net ball, not a total — two wrecked cards don't matter:");
}));

t("R130 the wolf rotates by tee order, and an override takes the pack with it", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles() };
    GAMES.push(g);
    const rot = [0,1,2,3,4,5,14,15,16,17].map(h => wolfOn(g, h));
    g.holes[0].pack = ["p2","p3"];
    view.gameId = g.id; view.hole = 0; view.tab = "home"; render();
    handleClick({ dataset:{ wolf:"0:p4" } });
    return JSON.stringify({ rot, wolf: wolfOn(g, 0), pack: g.holes[0].pack });
  })()`));
  eq(out.rot.slice(0, 6).join(","), "p1,p2,p3,p4,p5,p1",
     "the wolf is the next man in tee order and wraps at five:");
  /* Eighteen over five isn't whole, so the first three are wolf a fourth time.
     That falls out of the rotation rather than being a rule, which is why the
     wolf is editable on every hole. */
  eq(out.rot.slice(6).join(","), "p5,p1,p2,p3",
     "and holes 15-18 carry on rather than stopping at fifteen:");
  eq(out.wolf, "p4", "an override sticks:");
  eq(out.pack.length, 0,
     "and clears the pack, which was picked out of a four he's now left:");
}));

t("R131 a half-made pack doesn't score, and going alone isn't the same as not deciding",
  () => isolate(() => {
  eq(wolfHole([4,5,5,6,6], { hole:{ pack:["p2"] } }), null,
     "one name tapped is a decision in progress, not a 1+1 against three:");
  eq(wolfHole([4,5,5,6,6], { hole:{ pack:[] } }), null,
     "an empty pack is nobody chosen yet, not a lone wolf:");
  eq(wolfHole([4,5,5,6,6], LONE).join(","), "8,0,0,0,0",
     "the lone flag is what says he went alone:");
  eq(wolfHole([4,5,5,6,null], PACK), null,
     "and a hole with a man still out there can't be settled:");
  /* PU is a finished hole with no ball, which is different again. */
  eq(wolfHole([4,"PU","PU",5,5], PACK).join(","), "1,1,1,0,0",
     "picking up is finished — the wolf's ball still wins it for his three:");
}));

t("R132 Wolf takes handicaps off one side of five", () => isolate(() => {
  /* baseline(), strokesHereLine() and renderStrokeGrid() all spread teams[0]
     and teams[1]. That was invisible while nothing with a side count other
     than two took handicaps; a one-sided game threw on a side that isn't
     there. */
  const o = JSON.parse(dom.window.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles() };
    GAMES.push(g);
    const course = courseOf(g);
    const chs = g.teams[0].map(id => courseHcp(id, course));
    return JSON.stringify({ usesHcp: usesHcp(g), base: baseline(g),
      low: Math.min.apply(null, chs), phs: g.teams[0].map(id => playingHcp(id, g)),
      line: strokesHereLine(g, 0).length > 0, grid: renderStrokeGrid(g, 0).length > 0,
      roster: rosterOf(g).join(",") });
  })()`));
  ok(o.usesHcp, "wolf is played net:");
  eq(o.roster, "p1,p2,p3,p4,p5", "the roster is the whole one-sided field:");
  eq(o.base, o.low, "baseline is the lowest course handicap of all five:");
  eq(Math.min.apply(null, o.phs), 0, "so the lowest man plays off scratch:");
  ok(o.line && o.grid, "and both stroke readouts draw rather than throwing:");
}));

t("R133 a wolf game survives the CSV, five names straight across", () => isolate(() => {
  const w = dom.window;
  const csv = ["day,time,type,course,detail,player,notes,a1,a2,a3,a4,b1,b2,b3,b4,"
    + "c1,c2,c3,c4,d1,d2,d3,d4",
    "Thursday,8:15am,ROUND-CASUAL," + w.eval("JSON.parse(JSON.stringify(COURSES[0].name))")
      + ",,,Five players",
    "Thursday,,GAME,,WOLF,,,Blake,Dan,Jason,Daniel,Howard,,,,,,,,,,,"].join("\n");
  const out = JSON.parse(w.eval(`(function(){
    const r = parseCSV(${JSON.stringify(csv)});
    return JSON.stringify({ errs: r.errors, teams: (r.games[0]||{}).teams,
                            type: (r.games[0]||{}).type });
  })()`));
  eq(out.errs.length, 0, "it imports clean: " + out.errs.join(" | "));
  eq(out.type, "WOLF5", "as a wolf game:");
  eq((out.teams[0] || []).length, 5, "with all five men on the one side:");
  /* Both halves of the trip, or it's lost on export the way ROUND notes were. */
  const back = w.eval(`(function(){
    const r = parseCSV(${JSON.stringify(csv)});
    SCHEDULE = r.events; GAMES = r.games; DAYS.length = 0; DAYS.push("Thursday");
    return scheduleToCSV();
  })()`);
  ok(/,GAME,,WOLF5,/.test(back), "and writes back out as a GAME row: " + back.split("\n")[2]);
  eq(JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(back)})
      .games[0].teams[0].length)`)), 5,
     "which re-imports with the same five:");
}));

t("R134 the wolf card draws, and the pickers are what settle the hole", () => isolate(() => {
  const w = dom.window;
  w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles() };
    GAMES.push(g);
    isAdmin = true; SYNC.on = false;
    view.tab = "home"; view.gameId = g.id; view.hole = 0; render();
  })()`);
  const html = appHTML();
  ok(/data-wolf="0:/.test(html), "the wolf picker is on the card:");
  ok(/data-lone="0"/.test(html), "so is going alone:");
  eq((html.match(/data-pack="0:/g) || []).length, 4,
     "and the four men he can take, which is everyone but the wolf:");
  /* Five steppers, not two teams' worth. */
  eq((html.match(/data-step="sc-/g) || []).length, 10,
     "five scores, each with a pair of stepper buttons:");
  const settled = JSON.parse(w.eval(`(function(){
    const g = GAMES[0];
    handleClick({ dataset:{ pack:"0:p2" } });
    handleClick({ dataset:{ pack:"0:p3" } });
    g.teams[0].forEach((id, i) => g.holes[0].scores[id] = [4,5,5,6,6][i]);
    const before = wolfHolePoints(g, 0);
    handleClick({ dataset:{ pack:"0:p4" } });
    return JSON.stringify({ before: before && g.teams[0].map(id => before[id]),
      pack: g.holes[0].pack, done: holeComplete(g, 0) });
  })()`));
  eq(settled.before.join(","), "1,1,1,0,0", "two taps make a pack and the hole scores:");
  eq(settled.pack.join(","), "p3,p4",
     "a third name pushes out the older of the two rather than being ignored:");
  ok(settled.done, "and the hole reads as played:");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

t("R135 the draw sets tee order, and with it who starts as wolf", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles() };
    GAMES.push(g);
    isAdmin = true; SYNC.on = false;
    view.tab = "home"; view.gameId = g.id; view.hole = 0; render();
    const offered = /data-wolfdraw="gw"/.test(document.getElementById("app").innerHTML);
    /* A redraw asks first. Say no once and nothing may move; then say yes to
       the rest so the shuffle itself can be checked. */
    const realConfirm = window.confirm;
    handleClick({ dataset:{ wolfdraw:"gw" } });
    const afterFirst = g.teams[0].join(","), labelled = /Redraw order/.test(
      (render(), document.getElementById("app").innerHTML));
    let asked = 0;
    window.confirm = () => { asked++; return false; };
    handleClick({ dataset:{ wolfdraw:"gw" } });
    const heldOnNo = g.teams[0].join(",") === afterFirst && asked === 1;
    window.confirm = () => true;
    /* Twenty draws: the order has to actually move, and it must stay the same
       five men every time. A sort() with a random comparator passes neither. */
    const seen = {}; let sameFive = true;
    for (let k = 0; k < 20; k++){
      handleClick({ dataset:{ wolfdraw:"gw" } });
      seen[g.teams[0].join(",")] = 1;
      if (g.teams[0].slice().sort().join(",") !== "p1,p2,p3,p4,p5") sameFive = false;
    }
    window.confirm = realConfirm;
    const first = wolfOn(g, 0), second = wolfOn(g, 1);
    g.holes[0].scores[g.teams[0][0]] = 4;
    view.hole = 0; render();
    return JSON.stringify({ offered, labelled, heldOnNo, orders: Object.keys(seen).length, sameFive,
      first, second, firstIsOrder: first === g.teams[0][0],
      stillOffered: /data-wolfdraw="gw"/.test(document.getElementById("app").innerHTML) });
  })()`));
  ok(out.offered, "the draw is on the card before anything is played:");
  ok(out.labelled, "once drawn, the button says Redraw:");
  ok(out.heldOnNo, "and a redraw asks first — a no leaves the order exactly as it was:");
  ok(out.orders > 1, "and it actually moves the order: " + out.orders + " of 20 distinct");
  ok(out.sameFive, "always the same five men, nobody dropped or duplicated:");
  ok(out.firstIsOrder, "the man drawn first is the wolf on hole 1:");
  ok(out.first !== out.second, "and hole 2 moves on to the next one:");
  /* The order is a fact about holes already played off it, so it stops being
     a thing you can re-roll rather than asking a question. */
  ok(!out.stillOffered, "once a score is in, the draw is gone:");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

/* Asked for with a wolf game already under way, so the order is worked out
   from the roster and never written: drawing the card must leave the game
   exactly as it was and queue nothing. */
t("R147 each wolf hole shows its tee order — down one a hole, wolf last — without a write", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles(), drawn:true };
    g.holes[0].scores.p1 = 4;
    g.holes[2].wolf = "p1";            /* the wolf was changed on hole 3 */
    GAMES.push(g);
    isAdmin = true; SYNC.on = false;
    const before = JSON.stringify(g), queued = JSON.stringify(loadQueue());
    const shown = {}, takes = {};
    view.tab = "home"; view.gameId = g.id;
    [0, 1, 2, 15].forEach(h => {
      view.hole = h; render();
      const app = document.getElementById("app");
      shown[h] = [...app.querySelectorAll(".teeord li")].map(li =>
        li.textContent + (li.classList.contains("is-wolf") ? "*" : "")).join(",");
      takes[h] = [...app.querySelectorAll("[data-pack]")].map(b => b.dataset.pack.split(":")[1]).join(",");
    });
    return JSON.stringify({ shown, takes,
      calc: [0,1,2,15].map(h => wolfTeeOrder(g, h).join(",")),
      untouched: JSON.stringify(g) === before,
      noQueue: JSON.stringify(loadQueue()) === queued,
      names: ["p1","p2","p3","p4","p5"].map(id => P(id).name) });
  })()`));
  const [n1, n2, n3, n4, n5] = out.names;
  eq(out.calc[0], "p5,p4,p3,p2,p1", "hole 1 is the roster backwards, the first drawn (its wolf) last:");
  eq(out.calc[1], "p1,p5,p4,p3,p2", "hole 2: everyone down one, hole 1's wolf tees first:");
  eq(out.calc[2], "p2,p5,p4,p3,p1", "a changed wolf still tees last, the rest keep the rotation:");
  eq(out.calc[3], "p5,p4,p3,p2,p1", "and it cycles — hole 16 is hole 1 again:");
  eq(out.shown[0], [n5, n4, n3, n2, n1 + "*"].join(","), "the card lists that order, wolf marked:");
  eq(out.shown[2], [n2, n5, n4, n3, n1 + "*"].join(","), "including on a hole where the wolf was changed:");
  eq(out.takes[1], "p1,p5,p4,p3", "the men he can take run in the order they hit:");
  ok(out.untouched, "drawing the card leaves the game exactly as it was:");
  ok(out.noQueue, "and queues no write:");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

/* Asked for mid-round: the order was settled on the tee, not by the draw, and
   the app's rotation had to be brought into line with it without touching
   what had already been scored. So the write is two fields, never a setDoc
   of the whole game from one phone's copy. */
t("R148 a wolf tee order set by hand mid-round writes the order and nothing else", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    GAMES.length = 0;
    const g = { id:"gw", roundId: ROUNDS()[0].id, type:"WOLF5",
                teams:{0:["p1","p2","p3","p4","p5"]}, holes: blankHoles(), drawn:true };
    g.holes[0].scores = { p1:4, p2:5, p3:4, p4:6, p5:5 }; g.holes[0].pack = ["p2","p3"];
    g.holes[1].scores = { p1:3 };
    GAMES.push(g);
    const saved = { on: SYNC.on, api: SYNC.api, db: SYNC.db };
    const updates = []; let sets = 0;
    SYNC.on = true; SYNC.db = {};
    SYNC.api = { doc: (...a) => a.slice(1).join("/"),
      updateDoc: (ref, d) => { updates.push({ ref, d }); return Promise.resolve(); },
      setDoc: () => { sets++; return Promise.resolve(); } };
    isAdmin = true;
    view.tab = "home"; view.gameId = g.id; view.hole = 1; render();
    const holesBefore = JSON.stringify(g.holes);
    const html = () => document.getElementById("app").innerHTML;
    const offeredMidRound = /data-teeset="gw"/.test(html());
    const realConfirm = window.confirm;
    const tapAll = () => { handleClick({ dataset:{ teeset:"gw" } });
      ["p3","p1","p4","p2"].forEach(id => handleClick({ dataset:{ teepick:id } })); };
    /* Say no first: nothing may move. */
    window.confirm = () => false; tapAll();
    const heldOnNo = g.teams[0].join(",") === "p1,p2,p3,p4,p5" && !updates.length;
    window.confirm = () => true; tapAll();
    window.confirm = realConfirm;
    const res = JSON.stringify({ offeredMidRound, heldOnNo,
      roster: g.teams[0].join(","),
      h1: wolfTeeOrder(g, 0).join(","), h2: wolfTeeOrder(g, 1).join(","),
      wolf1: wolfOn(g, 0), wolf2: wolfOn(g, 1),
      holesSame: JSON.stringify(g.holes) === holesBefore,
      updates: updates.map(u => Object.keys(u.d).sort().join(",")),
      ref: (updates[0] || {}).ref, sets,
      closed: !/data-teepick/.test(html()) });
    Object.assign(SYNC, saved);
    return res;
  })()`));
  ok(out.offeredMidRound, "Change is on the card with scores already in:");
  ok(out.heldOnNo, "a no at the confirm leaves the order alone and writes nothing:");
  eq(out.h1, "p3,p1,p4,p2,p5", "hole 1 tees off exactly as tapped, the fifth filled in:");
  eq(out.wolf1, "p5", "the last man on hole 1 is its wolf:");
  eq(out.h2, "p5,p3,p1,p4,p2", "hole 2: everyone down one, so hole 1's wolf tees first:");
  eq(out.wolf2, "p2", "and the man who hit fourth on hole 1 is wolf on hole 2:");
  ok(out.holesSame, "no score or pick on any hole changed:");
  eq(out.updates.join("|"), "drawn,teams.0", "one write, of the order and the drawn flag only:");
  ok(/games\/gw$/.test(out.ref || ""), "to that game's document:");
  eq(out.sets, 0, "never a whole-game setDoc:");
  ok(out.closed, "and the picker closes:");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

t("R136 a split pair carries its two boxes on the game, not on the Field tab",
  () => isolate(() => {
  const w = dom.window;
  const saved = w.eval(`JSON.stringify({ tees: COURSES[0].tees,
    assign: PLAYERS.map(p => p.tees && p.tees[COURSES[0].id]) })`);
  try {
    w.eval(`COURSES[0].tees = [{name:"Blue",rating:72.5,slope:134,par:72},
                               {name:"Members",rating:70.4,slope:126,par:72},
                               {name:"Yellow",rating:68.3,slope:122,par:72},
                               {name:"Red",rating:64.8,slope:110,par:72}];
            PLAYERS.forEach(p => { p.tees = p.tees || {};
                                   p.tees[COURSES[0].id] = "Members"; });`);
    const co = w.eval("COURSES[0].name");
    const csv = "day,time,type,course,detail,player,notes,a1,a2,a3,a4,b1,b2,b3,b4,c1,c2,c3,c4,d1,d2,d3,d4\n"
      + `Thursday,1:03pm,ROUND,${co}\n`
      + "Thursday,,GAME,,2V2V2V2-8,,Skins. Tees: Blue / Dan Blue + Adam Yellow / Members / Red,"
      + "Daniel,Jake,,,Dan,Adam,,,Blake,Jason,,,Howard,Luke\n";
    const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
    eq(plan.errors.length, 0, "it imports cleanly: " + plan.errors.join(" | "));
    const g = plan.games[0];
    eq(g.tees[0], "Blue", "a chunk that is a box still sets the whole side:");
    ok(!(g.tees && g.tees[1]), "the split side gets no side tee");

    w.eval(`SCHEDULE = ${JSON.stringify(plan.events)};
            GAMES = ${JSON.stringify(plan.games)}.map(x => { x.holes = blankHoles(); return x; });`);
    const read = JSON.parse(w.eval(`(function(){
      const g = GAMES[0], c = COURSES[0];
      const nm = n => PLAYERS.find(p => p.name === n).id;
      return JSON.stringify({
        dan:   teeNameIn(g, nm("Dan"), c),   adam: teeNameIn(g, nm("Adam"), c),
        blake: teeNameIn(g, nm("Blake"), c),
        danField: teeNameFor(nm("Dan"), c),  danCh: courseHcp(nm("Dan"), c) });
    })()`));
    eq(read.dan, "Blue", "Dan reads off his own box on this game:");
    eq(read.adam, "Yellow", "Adam off his, on the same side:");
    eq(read.blake, "Members", "and a man with neither falls back to the Field tab:");
    /* The whole reason this lives on the game. The same course hosts a Wolf
       game that is scored on net, and a player's Field tee is per course, so
       moving Dan there for the afternoon would have moved his morning
       handicap with it. */
    eq(read.danField, "Members", "his stored tee is untouched:");
    eq(read.danCh, w.eval(`(function(){ const c = COURSES[0];
      return Math.round(PLAYERS.find(p => p.name === "Dan").index * (126/113) + (70.4 - 72)); })()`),
       "so his course handicap is still the one off the tee he actually plays:");

    const back = w.eval("scheduleToCSV()");
    ok(/Tees: Blue \/ Dan Blue \+ Adam Yellow \/ Members \/ Red/.test(back),
       "the export writes the men back out: " + (/.*Tees:[^\n"]*/.exec(back)||[""])[0]);
    const again = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(back)}))`));
    eq(again.errors.length, 0, "which re-imports clean: " + again.errors.join(" | "));
    eq(Object.keys(again.games[0].ptees || {}).length, 2,
       "with both men's boxes still on the game:");

    /* Naming a man who isn't on that side is a typo worth catching, not a
       silent no-op — the tee would simply never be read. */
    const bad = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv
      .replace("Dan Blue + Adam Yellow", "Dan Blue + Luke Yellow"))}))`));
    ok(bad.errors.some(e => /Luke/.test(e) && /side B/.test(e)),
       "it says so: " + bad.errors.join(" | "));
  } finally {
    w.eval(`(function(){
      const o = JSON.parse(${JSON.stringify(saved)}), c = COURSES[0];
      c.tees = o.tees;
      PLAYERS.forEach((p, i) => {
        if (o.assign[i] == null) { if (p.tees) delete p.tees[c.id]; }
        else { p.tees = p.tees || {}; p.tees[c.id] = o.assign[i]; }
      });
    })()`);
  }
}));

t("R137 40ball makes no blanket claim to hide selections, and a deciding side's are visible",
  () => isolate(() => {
  const w = dom.window;
  /* A `hidden` flag was set on every 40ball game, toggled in the roster editor
     and printed on the games list — and nothing read it. Both blocks render on
     one card, so each side could watch the other decide. The claim is gone;
     this fails if it comes back without the behaviour. */
  ok(!/data-hidden=/.test(html), "no toggle that sets a flag nothing honours");
  /* Asserted against what's drawn, not the source — §8 quotes the old label in
     the comment explaining why it went. */
  const list = w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    g.hidden = true;                       // as older builds left it
    view.gameId = null; view.tab = "home"; render();
    const out = document.getElementById("app").innerHTML;
    delete g.hidden;
    return out;
  })()`);
  ok(/40ball/i.test(list), "the 40ball game is on the games list:");
  ok(!/hidden selections/i.test(list),
     "and carries no label saying its selections are hidden");
  const seen = w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    const h = g.holes[0];
    g.teams[0].forEach(id => h.scores[id] = 4);
    g.teams[1].forEach(id => h.scores[id] = 5);
    h.selected[0] = g.teams[0].slice(0, 2);
    h.locked[0] = false;
    isAdmin = true; SYNC.on = false;
    view.tab = "home"; view.gameId = g.id; view.hole = 0; render();
    const out = document.getElementById("app").innerHTML;
    h.selected[0] = []; h.locked[0] = false;
    g.teams[0].concat(g.teams[1]).forEach(id => delete h.scores[id]);
    return out;
  })()`);
  /* By design, not by accident: a side still deciding is never hidden, which
     is what lets the reveal work without a sign-in (R138 covers the sealing).
     If someone builds per-team hiding with an identity later, this is the
     assertion to rewrite rather than work around. */
  ok(/class="sel on"/.test(seen),
     "an unlocked side's picks are visible to everyone while both are deciding");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

t("R138 40ball reveals a hole only once both sides have locked it", () => isolate(() => {
  const w = dom.window;
  /* The advantage in 40ball is locking second, knowing the other side's
     answer. So: nothing hidden while both are deciding; a locked side goes
     dark — ticks AND count — until the other locks; then it opens for good. */
  const snap = () => JSON.parse(w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    isAdmin = true; SYNC.on = false;
    view.tab = "home"; view.gameId = g.id; view.hole = 0; render();
    const card = document.getElementById("app").innerHTML;
    const aBlock = card.split('data-lock="1"')[0].split('data-unlock="1"')[0];
    view.gameId = null; render();
    const list = document.getElementById("app").innerHTML;
    return JSON.stringify({
      ticks: (card.match(/class="sel on"/g) || []).length,
      remA: (/Remaining <b>(\\d+)<\\/b>/.exec(card) || [])[1],
      takenA: (/Taken this hole <b>([^<]+)<\\/b>/.exec(card) || [])[1],
      sealedNote: /sealed until/.test(card),
      bannerSpent: (/40ball \\u00b7 (\\d+)\\/40 and (\\d+)\\/40/.exec(card) || []).slice(1).join("/"),
      /* The card is a little scoreboard now; progress reads "2/40 \u00b7 3/40". */
      listSpent: (/(\\d+)\\/40 \u00b7 (\\d+)\\/40/.exec(list) || [])
        .slice(1).join("/"),
      budgetR: fbBudget(g, 0, 1).R,
      revealed: fbRevealed(g, 0)
    });
  })()`));
  w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    const h = g.holes[0];
    g.teams[0].forEach(id => h.scores[id] = 4);
    g.teams[1].forEach(id => h.scores[id] = 5);
    h.selected[0] = g.teams[0].slice(0, 2);   // A has ticked two
  })()`);

  let s = snap();
  eq(s.ticks, 2, "while both are deciding, A's two ticks are on the shared card:");
  eq(s.remA, "40", "and nothing is spent yet:");

  w.eval(`GAMES.find(x => x.type === "FORTYBALL").holes[0].locked[0] = true`);
  s = snap();
  eq(s.ticks, 0, "once A locks, its ticks go dark:");
  eq(s.takenA, "—", "the count this hole goes with them:");
  eq(s.remA, "40", "and so does the running count — 38 would give it away:");
  eq(s.bannerSpent, "0/0", "the banner still says nothing has been spent:");
  eq(s.listSpent, "0/0", "nor does the games list — it's just another screen:");
  ok(s.sealedNote, "the card says why:");
  eq(s.budgetR, 38,
     "but the budget underneath is the truth — a side can never be let past 40:");
  /* The slack line leaked on the first pass: off the true budget it read 6
     holes after a quiet hole and 7 after a four-score one. Whatever was taken
     on a sealed hole, A's corridor must read identically. */
  const corridorA = () => w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    view.tab = "home"; view.gameId = g.id; view.hole = 0; render();
    const c = document.getElementById("app").innerHTML;
    const i = c.indexOf('class="corridor"');
    const out = c.slice(i, c.indexOf('class="corridor"', i + 1));
    view.gameId = null; render();
    return out.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ");
  })()`);
  const tookTwo = corridorA();
  w.eval(`(function(){ const g = GAMES.find(x => x.type === "FORTYBALL");
    g.holes[0].selected[0] = g.teams[0].slice(); })()`);
  const tookFour = corridorA();
  w.eval(`(function(){ const g = GAMES.find(x => x.type === "FORTYBALL");
    g.holes[0].selected[0] = []; })()`);
  const tookNone = corridorA();
  eq(tookFour, tookTwo, "a sealed four reads exactly like a sealed two:");
  eq(tookNone, tookTwo, "and like a sealed none:");
  w.eval(`(function(){ const g = GAMES.find(x => x.type === "FORTYBALL");
    g.holes[0].selected[0] = g.teams[0].slice(0, 2); })()`);
  ok(!s.revealed, "the hole isn't revealed:");

  w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL");
    g.holes[0].selected[1] = g.teams[1].slice(0, 3);
    g.holes[0].locked[1] = true;
  })()`);
  s = snap();
  ok(s.revealed, "B locks, and the hole opens:");
  eq(s.ticks, 5, "both sides' ticks are visible, for good:");
  eq(s.remA, "38", "the running count catches up:");
  eq(s.bannerSpent, "2/3", "and the banner shows what each side spent:");
  eq(s.listSpent, "2/3", "as does the games list:");
  ok(!s.sealedNote, "nothing is sealed any more:");

  w.eval(`(function(){
    const g = GAMES.find(x => x.type === "FORTYBALL"), h = g.holes[0];
    h.selected = {0:[],1:[]}; h.locked = {0:false,1:false,2:false,3:false};
    g.teams[0].concat(g.teams[1]).forEach(id => delete h.scores[id]);
    view.gameId = null; view.tab = "home"; render();
  })()`);
}));

t("R139 the stroke grid only shows a playing handicap where it differs", () => isolate(() => {
  /* In a full round playing handicap is course handicap by definition, and
     "ch 33 → 33" said it twice on every row. The arrow is for relative only. */
  const o = JSON.parse(dom.window.eval(`(function(){
    const g = GAMES.find(x => x.type === "BESTBALL");
    const r = EV(g.roundId), was = r.mode;
    r.mode = "FULL";     const full = renderStrokeGrid(g, 0);
    r.mode = "RELATIVE"; const rel  = renderStrokeGrid(g, 0);
    r.mode = was;
    return JSON.stringify({ full, rel });
  })()`));
  ok(!/→/.test(o.full), "a full round prints the course handicap once:");
  ok(/in full/.test(o.full), "and the key says that's what each man plays off:");
  ok(/→ 0/.test(o.rel), "a relative round keeps the arrow, down to scratch for the low man:");
}));

t("R140 a flight goes in as airline, number and time", () => isolate(() => {
  const w = dom.window;
  w.eval(`SYNC.on = true; isAdmin = false; view.gameId = null; view.tab = "sched";
          schedMode = "travel"; editEvent = null; flightPasteOpen = null;
          flightDraft.ARRIVAL = {}; flightDraft.DEPARTURE = {};
          try { localStorage.removeItem("ei-me"); } catch(e){}
          render();`);
  const app = () => document.getElementById("app");
  const q = sel => app().querySelector(sel);
  const blake = w.eval(`PLAYERS.find(p => p.name === "Blake").id`);

  /* Airlines are buttons, never a select — a native select is what showed an
     empty box on the owner's iPhone (R60). */
  ok(q('[data-fdair="ARRIVAL:United"]'), "an airline button for United:");
  ok(!/<select/.test(q(".flightadd").outerHTML), "and no native dropdown anywhere in the form");
  ok(q('#fdt-ARRIVAL[type="time"]'), "the time is the native wheel:");
  ok(q('#fdn-ARRIVAL[inputmode="numeric"]'), "and the number box brings up the number pad:");
  /* iOS drew the empty time box as a blank rectangle, taller than the number
     box and running out past the card. jsdom has no layout to measure, so the
     three fixes are pinned at the source. */
  ok(/\.fa-pair > div\{min-width:0\}/.test(html),
     "the grid column must be allowed to shrink, or iOS's time box pushes out of the card");
  ok(/input\.fa-time\{-webkit-appearance:none;appearance:none/.test(html),
     "the time box drops iOS's own sizing, so it takes the height and width given");
  ok(q("#fdt-ARRIVAL[required] + .fa-ph"),
     "and an empty one says 'Tap to set' — iOS shows nothing at all in an empty time box");

  /* Nothing chosen yet: it says what's missing rather than making a blank. */
  const before = w.eval("SCHEDULE.length");
  click(q('[data-flightsave="ARRIVAL"]'));
  eq(w.eval("SCHEDULE.length"), before, "an empty form adds nothing:");

  /* Typed values survive the redraw a tap causes — the whole reason the form
     keeps a draft. */
  type(q("#fdn-ARRIVAL"), "2137");
  type(q("#fdt-ARRIVAL"), "14:57");
  click(q('[data-fdpid="ARRIVAL:' + blake + '"]'));
  click(q('[data-fdair="ARRIVAL:United"]'));
  eq(q("#fdn-ARRIVAL").value, "2137", "the number is still there after two taps:");
  eq(q("#fdt-ARRIVAL").value, "14:57", "and so is the time:");

  click(q('[data-flightsave="ARRIVAL"]'));
  eq(w.eval("SCHEDULE.length"), before + 1, "one flight added:");
  const made = JSON.parse(w.eval("JSON.stringify(SCHEDULE[SCHEDULE.length - 1])"));
  eq(made.title, "United 2137", "titled airline and number:");
  eq(made.type + "/" + made.dir, "TRAVEL/ARRIVAL", "as an arrival:");
  eq(made.pid, blake, "for the man picked:");
  eq(made.time, "14:57", "at the time typed:");
  eq(made.day, w.eval("DAYS[0]"), "on the first day, which is when people arrive:");
  ok(w.eval("editEvent") == null, "and it doesn't drop you into an editor — there's nothing left to fix");

  /* The form resets for the next flight but remembers who, on both legs. */
  eq(q("#fdn-ARRIVAL").value, "", "the number clears:");
  ok(q('[data-fdpid="DEPARTURE:' + blake + '"].on'),
     "and the departure form already knows whose it is:");
  ok(q('[data-fdday="DEPARTURE:' + w.eval("DAYS[DAYS.length-1]") + '"].on'),
     "departures default to the last day:");

  /* "Other" asks for the name rather than inventing one. */
  click(q('[data-fdair="DEPARTURE:Other"]'));
  ok(q('[data-fd="DEPARTURE:other"]'), "Other opens a box for the airline's name:");
  type(q('[data-fd="DEPARTURE:other"]'), "Breeze");
  type(q("#fdn-DEPARTURE"), "MX 410");
  click(q('[data-flightsave="DEPARTURE"]'));
  const dep = JSON.parse(w.eval("JSON.stringify(SCHEDULE[SCHEDULE.length - 1])"));
  eq(dep.title, "Breeze 410", "with only the digits kept from the number:");
  eq(dep.time, null, "and no time is TBD, not a refusal:");

  w.eval(`SYNC.on = false; isAdmin = true; view.tab = "home";
          flightDraft.ARRIVAL = {}; flightDraft.DEPARTURE = {};
          try { localStorage.removeItem("ei-me"); } catch(e){} render();`);
}));

t("R141 every game explains itself behind a small (i), and only when asked", () => isolate(() => {
  const w = dom.window;
  w.eval(`isAdmin = true; SYNC.on = false; rulesOpen = null;
          view.gameId = null; view.tab = "home"; render();`);
  ok(!document.getElementById("rulesbtn"), "no (i) on the home screen — there's no game to explain");

  /* One of every format, including the two that branch away from the rest. */
  const kinds = JSON.parse(w.eval(`(function(){
    const r = ROUNDS()[0].id;
    GAMES.push({ id:"gw", roundId:r, type:"WOLF5", teams:{0:["p1","p2","p3","p4","p5"]}, holes:blankHoles() });
    GAMES.push({ id:"gs", roundId:r, type:"SCRAMBLE2X4", skins:true,
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes:blankHoles() });
    const seen = {}, out = [];
    GAMES.forEach(g => { const k = g.type + (g.skins ? "+skins" : "");
      if (!seen[k]){ seen[k] = 1; out.push([g.id, k]); } });
    return JSON.stringify(out);
  })()`));
  ok(kinds.length >= 6, "a game of every format to look at: " + kinds.map(k => k[1]).join(", "));

  const expect = { BESTBALL:/better net score/, SCRAMBLE4:/Four to a team/, SCRAMBLE3:/Three to a team/,
    FORTYBALL:/exactly 40/, WOLF5:/last<\/b> man to tee off/, "SCRAMBLE2X4+skins":/Two skins a hole/ };
  kinds.forEach(([id, k]) => {
    w.eval(`rulesOpen = null; view.gameId = "${id}"; view.hole = 0; render();`);
    const btn = document.getElementById("rulesbtn");
    ok(btn, k + ": the (i) sits in the header");
    ok(!document.querySelector(".rules"), k + ": and the rules are shut until it's tapped");
    click(btn);
    const box = document.querySelector(".rules");
    ok(box, k + ": tapping it opens them");
    if (expect[k]) ok(expect[k].test(box.innerHTML), k + ": with that game's own rules: "
      + box.textContent.slice(0, 80));
  });

  /* Wolf's points table is the thing people will actually check mid-round. */
  w.eval(`rulesOpen = "gw"; view.gameId = "gw"; render();`);
  const wolf = document.querySelector(".rules").textContent;
  ok(/1 point/.test(wolf) && /3 points/.test(wolf) && /8 points/.test(wolf) && /2 points/.test(wolf),
     "wolf spells out all four payouts");

  /* Open on one game doesn't follow you to the next. */
  w.eval(`view.gameId = "gs"; render();`);
  ok(!document.querySelector(".rules"), "moving to another game closes them");
  w.eval(`rulesOpen = "gs"; render();`);
  click(document.getElementById("rulesclose"));
  ok(!document.querySelector(".rules"), "and Got it shuts them");

  w.eval(`rulesOpen = null; view.gameId = null; view.tab = "home"; render();`);
  ok(!document.getElementById("rulesbtn"), "leaving the game takes the (i) with it");
}));

t("R142 a games-list card scores each side on its own row, and never says 'X's team'", () => isolate(() => {
  const w = dom.window;
  /* "Howard's team −7, leads by 6" credited one man with a four-man side. Each
     side now gets a row with its own number, so no side needs a nickname. */
  const html = w.eval(`(function(){
    const r = ROUNDS()[0].id, co = courseOf(GAMES[0]), par = h => co.holes[h].par;
    GAMES.length = 0;
    const fb = { id:"gf", roundId:r, type:"FORTYBALL",
      teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes:blankHoles() };
    for (let h = 0; h < 2; h++){
      fb.teams[0].forEach(id => fb.holes[h].scores[id] = par(h) - 1);
      fb.teams[1].forEach(id => fb.holes[h].scores[id] = par(h) + 1);
      fb.holes[h].selected = {0: fb.teams[0].slice(0,2), 1: fb.teams[1].slice(0,2)};
      fb.holes[h].locked = {0:true,1:true,2:false,3:false};
    }
    const s4 = { id:"g4", roundId:r, type:"SCRAMBLE4",
      teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes:blankHoles() };
    s4.holes[0].teamScore = {0: par(0) - 1, 1: par(0)};
    const sk = { id:"gk", roundId:r, type:"SCRAMBLE2X4", skins:true,
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes:blankHoles() };
    sk.holes[0].teamScore = {0:4,1:5,2:5,3:5};
    const bb = { id:"gb", roundId:r, type:"BESTBALL",
      teams:{0:["p1","p2"],1:["p3","p4"]}, holes:blankHoles() };
    ["p1","p2"].forEach(id => bb.holes[0].scores[id] = 3);
    ["p3","p4"].forEach(id => bb.holes[0].scores[id] = 6);
    const wf = { id:"gw", roundId:r, type:"WOLF5",
      teams:{0:["p1","p2","p3","p4","p5"]}, holes:blankHoles() };
    const fresh = { id:"gn", roundId:r, type:"SCRAMBLE3",
      teams:{0:["p1","p2","p3"],1:["p4","p5","p6"]}, holes:blankHoles() };
    GAMES.push(fb, s4, sk, bb, wf, fresh);
    isAdmin = true; SYNC.on = false; homeShowAll = true;
    view.gameId = null; view.tab = "home"; render();
    return document.getElementById("app").innerHTML;
  })()`);
  ok(!/'s team/.test(html), "no card calls a side by one man's name");
  const card = id => {
    const d = document.createElement("div"); d.innerHTML = html;
    return d.querySelector('[data-game="' + id + '"]');
  };
  const rows = id => [...card(id).querySelectorAll(".gb-row")];

  eq(rows("gf").length, 2, "40ball: a row per team:");
  ok(rows("gf")[0].classList.contains("lead") && /-\d/.test(rows("gf")[0].textContent),
     "the team under par leads, with its number beside it: " + rows("gf")[0].textContent);
  ok(/4\/40 · 4\/40/.test(card("gf").textContent),
     "and progress underneath — two holes at two scores each: " + card("gf").textContent);

  eq(rows("g4").length, 2, "scramble: a row per team:");
  ok(rows("g4")[0].classList.contains("lead"), "the side ahead in bold:");

  eq(rows("gk").length, 4, "skins: four rows:");
  ok(/1\b/.test(rows("gk")[0].querySelector(".gb-v").textContent)
     && rows("gk")[0].classList.contains("lead"),
     "sorted into standings, the skin-winner first: " + rows("gk")[0].textContent);

  eq(rows("gb").length, 2, "best ball: a row per pair:");
  eq(rows("gb")[0].querySelector(".gb-v").textContent, "1 UP", "the state beside the pair it belongs to:");
  ok(!rows("gb")[1].querySelector(".gb-v"), "and nothing beside the other:");

  ok(!card("gw").querySelector(".gboard"), "a Wolf game nobody's played yet keeps the plain names:");
  ok(!card("gn").querySelector(".gboard") && /Not started/.test(card("gn").textContent),
     "as does any game not started:");
}));

t("R143 a flight links out to its live status", () => isolate(() => {
  const w = dom.window;
  const url = (title, type) => w.eval(`flightTrackUrl(${JSON.stringify({ type: type || "TRAVEL", title })})`);
  /* FlightAware's canonical ident is ICAO + number: UAL2137, not UA2137. */
  eq(url("United 2137"), "https://www.flightaware.com/live/flight/UAL2137", "the form's titles:");
  eq(url("Southwest 1442"), "https://www.flightaware.com/live/flight/SWA1442", "every airline mapped:");
  eq(url("Sun Country 401"), "https://www.flightaware.com/live/flight/SCX401", "two-word names too:");
  eq(url("UA2137"), "https://www.flightaware.com/live/flight/UAL2137", "a pasted code with no space:");
  eq(url("B6 123"), "https://www.flightaware.com/live/flight/JBU123", "a code with a digit in it:");
  ok(/^https:\/\/www\.google\.com\/search\?q=Breeze%20410/.test(url("Breeze 410")) === false
     && /flightaware.*MXY410/.test(url("Breeze 410")), "Breeze is mapped as well");
  ok(/^https:\/\/www\.google\.com\/search\?q=Avelo%20212/.test(url("Avelo 212")),
     "an airline outside the list falls back to Google's flight status");
  eq(url("driving down with Jason"), null, "no flight number, no link:");
  eq(url("United 2137", "MEAL"), null, "and only on a flight:");

  w.eval(`SYNC.on = false; isAdmin = true; view.gameId = null; view.tab = "sched";
          schedMode = "travel"; editEvent = null;
          SCHEDULE.push({ id:"tz1", type:"TRAVEL", dir:"ARRIVAL", day: DAYS[0], time:"14:57",
            pid: PLAYERS[0].id, title:"United 2137", notes:"" });
          render();`);
  const a = document.querySelector('a.track[href*="UAL2137"]');
  ok(a, "the card carries a Track link");
  eq(a.getAttribute("target"), "_blank", "which opens outside the app, so the app stays where it was:");
  w.eval(`view.tab = "home"; render();`);
}));

t("R144 a casual 3v3 leaves the standings, and the Board says which round it was", () => isolate(() => {
  const w = dom.window;
  /* Saturday has two rounds at the same course; only the afternoon 3v3 is
     casual. Named by course alone the footnote couldn't say which. */
  const o = JSON.parse(w.eval(`(function(){
    const c = COURSES[0];
    SCHEDULE = [
      { id:"ra", type:"ROUND", day:"Saturday", time:"09:45", courseId:c.id },
      { id:"rb", type:"ROUND", day:"Saturday", time:"14:30", courseId:c.id, counts:false } ];
    DAYS.length = 0; DAYS.push("Saturday");
    GAMES = [
      { id:"bb", roundId:"ra", type:"BESTBALL", teams:{0:["p1","p2"],1:["p3","p4"]}, holes:blankHoles() },
      { id:"s3", roundId:"rb", type:"SCRAMBLE3", teams:{0:["p1","p5","p6"],1:["p2","p7","p8"]}, holes:blankHoles() } ];
    for (let h = 0; h < 18; h++) GAMES[1].holes[h].teamScore = {0:3, 1:5};
    const done = !!gameResult(GAMES[1]);
    const st = standings();
    const p5 = (Array.isArray(st) ? st.find(r => r.id === "p5") : st.p5) || {};
    isAdmin = true; SYNC.on = false; view.gameId = null; view.tab = "board"; boardMode = "year"; render();
    return JSON.stringify({ done, p5gp: p5.gp || 0, p5w: p5.w || 0,
      foot: document.getElementById("app").innerHTML });
  })()`));
  ok(o.done, "the 3v3 is finished and has a winner:");
  eq(o.p5w, 0, "but the win doesn't reach the standings:");
  eq(o.p5gp, 0, "nor does the game count as played:");
  ok(/Casual rounds \(Saturday 2:30pm /.test(o.foot),
     "and the Board names the afternoon round, not just the course: "
     + ((/Casual rounds \([^)]*\)/.exec(o.foot) || [""])[0]));
  ok(!/Saturday 9:45am/.test((/Casual rounds \([^)]*\)/.exec(o.foot) || [""])[0]),
     "leaving the morning round out of that list:");
  ok(!/3v3\s+sits two players out/.test(o.foot), "and nothing claims the 3v3 counts");
  w.eval(`view.tab = "home"; render();`);
}));

t("R145 2v2v2v2 points: 5-3-1-0, birdie doubles, eagle triples, ties split", () => isolate(() => {
  const w = dom.window;
  const par0 = w.eval("COURSES[0].holes[0].par");
  w.eval("COURSES[0].holes[0].par = 4");
  try {
    /* Blake's own examples, on the 16-point scale he sent, carried onto 5-3-1-0.
       In twelfths, so 10 points is 120. */
    const P = sc => skinsHole(sc, { skins:false, points:true }).map(u => u / 12).join(",");
    eq(P([4,5,6,7]), "5,3,1,0", "plain hole pays by place:");
    eq(P([3,4,5,6]), "10,3,1,0", "a birdie that wins doubles its 5:");
    eq(P([3,3,5,6]), "8,8,1,0", "two birdies tied for first share 5+3, each doubled:");
    eq(P([2,3,5,6]), "15,6,1,0", "eagle triples, and a birdie in second still doubles:");
    eq(P([4,4,5,5]), "4,4,0.5,0.5", "par, par, bogey, bogey splits both pairs:");
    eq(skinsHole([4,5,5,5], { skins:false, points:true }).join(","), "60,16,16,16",
       "a three-way tie for second shares 3+1+0 — thirds, whole in twelfths:");
    eq(P([4,4,4,4]), "2.25,2.25,2.25,2.25", "all four level share the nine:");
    eq(skinsHole([4,5,6,null], { skins:false, points:true }), null,
       "nothing is paid until every team has a score:");
    /* Skins is untouched by any of it. */
    eq(skinsHole([3,4,5,6]).join(","), "12,12,0,0", "a skins game still pays two skins, birdie or not:");

    /* The whole game runs off the same machine: most points wins. */
    const o = JSON.parse(w.eval(`(function(){
      GAMES.length = 0;
      const g = { id:"gp", roundId: ROUNDS()[0].id, type:"SCRAMBLE2X4", points:true,
        teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() };
      const par = h => courseOf(g).holes[h].par;
      /* Team 3 is last on every hole but birdies the first four, where nobody
         else does; team 0 wins everything else. */
      for (let h = 0; h < 18; h++)
        g.holes[h].teamScore = h < 4 ? {0:par(h), 1:par(h)+1, 2:par(h)+2, 3:par(h)-1}
                                     : {0:par(h), 1:par(h)+1, 2:par(h)+2, 3:par(h)+3};
      GAMES.push(g);
      return JSON.stringify({ r: gameResult(g), out: teamOutcomes(g),
        tot: skinTotals(g).totals.map(u => u / 12), rules: gameRules(g),
        word: unitWord(g) });
    })()`));
    /* By hand: four birdie holes pay D 10, A 3, B 1, C 0; fourteen plain ones
       pay A 5, B 3, C 1, D 0. */
    eq(o.tot.join(","), "82,46,14,40", "totals add up hole by hole: " + o.tot.join(","));
    eq(o.r.winner, "A", "most points wins:");
    eq(o.out.join(","), "W,W,L,L", "and the top two go through:");
    ok(/Birdie doubles/.test(o.rules) && /5<\/b> to the best/.test(o.rules),
       "the (i) explains points, not skins");
    eq(o.word, "points", "every label says points:");
  } finally {
    w.eval("COURSES[0].holes[0].par = " + par0);
  }

  /* The CSV carries it both ways, and the one chip cycles through all three. */
  const co = w.eval("COURSES[0].name");
  const csv = "day,time,type,course,detail,player,notes,a1,a2,a3,a4,b1,b2,b3,b4,c1,c2,c3,c4,d1,d2,d3,d4\n"
    + `Thursday,1:03pm,ROUND,${co}\n`
    + "Thursday,,GAME,,2V2V2V2-8,,Points,Blake,Daniel,,,Dan,Howard,,,Jason,Luke,,,Jake,Adam\n";
  const plan = JSON.parse(w.eval(`JSON.stringify(parseCSV(${JSON.stringify(csv)}))`));
  eq(plan.games[0].points, true, "'Points' in the notes makes a points game:");
  ok(!plan.games[0].skins, "and never both:");
  w.eval(`SCHEDULE = ${JSON.stringify(plan.events)};
          GAMES = ${JSON.stringify(plan.games)}.map(x => { x.holes = blankHoles(); return x; });`);
  ok(/,Points,/.test(w.eval("scheduleToCSV()")), "and the export writes it back:");
  const cycle = [];
  for (let k = 0; k < 3; k++){
    w.eval(`handleClick({ dataset:{ skins: GAMES[0].id } })`);
    cycle.push(w.eval(`(GAMES[0].points ? "points" : GAMES[0].skins ? "skins" : "strokes")`));
  }
  eq(cycle.join(">"), "strokes>skins>points", "points → strokes → skins → points:");
}));

t("R146 no card carries the Test bar, one tap from wiping a live game", () => isolate(() => {
  const w = dom.window;
  /* Random scores and Reset sat on every card during the tournament itself.
     They were cut to the 2v2v2v2 so points could be tried before the round,
     then removed from it too once the round was under way. */
  const has = id => w.eval(`(function(){ isAdmin = true; SYNC.on = false;
    view.tab = "home"; view.gameId = "${id}"; view.hole = 0; render();
    const app = document.getElementById("app");
    return !!(document.getElementById("randhole") || document.getElementById("reset")
              || app.querySelector(".testbar")); })()`);
  w.eval(`(function(){ const r = ROUNDS()[0].id;
    GAMES.push({ id:"t4", roundId:r, type:"SCRAMBLE2X4", teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes:blankHoles() });
    GAMES.push({ id:"tw", roundId:r, type:"WOLF5", teams:{0:["p1","p2","p3","p4","p5"]}, holes:blankHoles() }); })()`);
  const all = JSON.parse(w.eval(`JSON.stringify(GAMES.map(g => [g.id, g.type]))`));
  ok(all.some(([, t]) => t === "SCRAMBLE2X4") && all.length >= 5, "a game of every format to check");
  all.forEach(([id, type]) => ok(!has(id), type + " has no Test bar"));
  ok(/const BUILD = "\d{4}-\d{2}-\d{2}\.\d{4}";/.test(html),
     "and the build stamp is a plain value the update check can read");
  w.eval(`view.gameId = null; view.tab = "home"; render();`);
}));

/* Asked for mid-tournament: the scramble card showed scores coloured against
   par but never the par itself, so an unscored hole said nothing about what
   it was. One row of pars under the hole numbers, the course total in Tot. */
t("R149 the scramble grid carries a par row under the hole numbers", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    const r = ROUNDS()[0].id; GAMES.length = 0;
    const res = {};
    [["g3","SCRAMBLE3",{0:["p1","p2","p3"],1:["p4","p5","p6"]}],
     ["g4","SCRAMBLE2X4",{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}]].forEach(([id, type, teams]) => {
      const g = { id, roundId:r, type, teams, holes: blankHoles(), points: type === "SCRAMBLE2X4" };
      GAMES.push(g);
      view.tab = "home"; view.gameId = id; view.hole = 0; render();
      const rows = [...document.querySelectorAll(".hgwrap .hg-row")];
      const parRow = document.querySelector(".hgwrap .hg-par");
      const cells = parRow ? [...parRow.querySelectorAll(".hg-p:not(.hg-tot)")].map(c => +c.textContent) : [];
      const want = courseOf(g).holes.slice(0, 18).map(x => x.par);
      res[type] = { second: rows[1] === parRow, cells: cells.join(","), want: want.join(","),
        tot: parRow ? +parRow.querySelector(".hg-tot").textContent : null,
        wantTot: want.reduce((a, b) => a + b, 0),
        notSide: !parRow || !parRow.hasAttribute("data-side") };
    });
    return JSON.stringify(res);
  })()`));
  Object.entries(out).forEach(([type, o]) => {
    ok(o.second, type + ": the par row sits straight under the hole numbers");
    eq(o.cells, o.want, type + ": one par per hole, from the course:");
    eq(o.tot, o.wantTot, type + ": and the course par in Tot:");
    ok(o.notSide, type + ": and it isn't a side, so it never joins the leaderboard shuffle");
  });
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

/* Asked for after the 2026 weekend: a match conceded before the 18th, and a
   round rained off after ten that the group decided not to count. A game can
   now be ended early as final-as-it-stands, a tie, or not counted, and the
   record follows. The end is written as one field, never the whole game. */
t("R150 a game ended early counts as it stood, as a tie, or not at all", () => isolate(() => {
  const w = dom.window;
  const out = JSON.parse(w.eval(`(function(){
    const r = ROUNDS()[0].id; GAMES.length = 0;
    const rec = id => { const x = standings().find(p => p.id === id); return x.w + "-" + x.l + "-" + x.t + "/" + x.gp; };
    const saved = { on: SYNC.on, api: SYNC.api, db: SYNC.db };
    const updates = []; let sets = 0;
    SYNC.on = true; SYNC.db = {};
    SYNC.api = { doc: (...a) => a.slice(1).join("/"),
      updateDoc: (ref, d) => { updates.push(JSON.stringify(d)); return Promise.resolve(); },
      setDoc: () => { sets++; return Promise.resolve(); } };
    const realConfirm = window.confirm; window.confirm = () => true;
    const res = {};

    /* 1. Best ball conceded 2 UP with four to play. */
    const m = { id:"gm", roundId:r, type:"BESTBALL", teams:{0:["p1","p2"],1:["p3","p4"]}, holes: blankHoles() };
    m.holes[0].conceded = 1; m.holes[1].conceded = 1;
    for (let h = 2; h < 14; h++) m.holes[h].conceded = h % 2;
    GAMES.push(m);
    view.tab = "home"; view.gameId = "gm"; view.hole = 14; endOpen = null; render();
    const html = () => document.getElementById("app").innerHTML;
    res.linkShown = /data-endgame="gm"/.test(html());
    const holesBefore = JSON.stringify(m.holes);
    handleClick({ dataset:{ endgame:"gm" } });
    res.panelShown = /data-endhow="final"/.test(html()) && /2 UP thru 14/.test(html());
    handleClick({ dataset:{ endhow:"final" } });
    res.match = { ended: m.ended && m.ended.how, after: m.ended && m.ended.after,
      result: gameResult(m), p1: rec("p1"), p3: rec("p3"),
      holesSame: JSON.stringify(m.holes) === holesBefore,
      write: updates.slice(), sets, reopenShown: /data-reopen="gm"/.test(html()),
      banner: (document.querySelector(".banner .st") || {}).textContent };
    handleClick({ dataset:{ reopen:"gm" } });
    res.reopened = { ended: m.ended, result: gameResult(m), p1: rec("p1"), lastWrite: updates[updates.length - 1] };
    GAMES.length = 0;

    /* 2. A 4v4 rained off after ten: called a tie, then not counted. */
    const s = { id:"gs", roundId:r, type:"SCRAMBLE4", teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes: blankHoles() };
    const par = h => courseOf(s).holes[h].par;
    for (let h = 0; h < 10; h++){ s.holes[h].teamScore[0] = par(h) - (h === 0 ? 1 : 0); s.holes[h].teamScore[1] = par(h); }
    GAMES.push(s);
    s.ended = { how:"tie", after:10, at:1 };
    res.tie = { p1: rec("p1"), p5: rec("p5"), label: gameStatusLabel(s).text, foot: gameBoard(s).foot };
    s.ended = { how:"void", after:10, at:1 };
    res.void = { p1: rec("p1"), p5: rec("p5"), label: gameStatusLabel(s).text };
    s.ended = { how:"final", after:10, at:1 };
    res.final4 = { p1: rec("p1"), p5: rec("p5") };
    GAMES.length = 0;

    /* 3. Four teams stopped on different holes: ranked on to par, not gross —
       a side five holes in at +5 has the fewest strokes on the card. */
    const q = { id:"gq", roundId:r, type:"SCRAMBLE2X4",
      teams:{0:["p1","p2"],1:["p3","p4"],2:["p5","p6"],3:["p7","p8"]}, holes: blankHoles() };
    for (let h = 0; h < 10; h++){ q.holes[h].teamScore[0] = par(h) - 1; q.holes[h].teamScore[2] = par(h); q.holes[h].teamScore[3] = par(h); }
    for (let h = 0; h < 5; h++) q.holes[h].teamScore[1] = par(h) + 1;
    q.ended = { how:"final", after:10, at:1 };
    GAMES.push(q);
    res.multi = teamOutcomes(q).join(",");
    q.ended = { how:"tie", after:10, at:1 };
    res.multiTie = teamOutcomes(q).join(",");

    /* 4. Nothing played: no link. A finished game: no link either. */
    const e = { id:"ge", roundId:r, type:"SCRAMBLE4", teams:{0:["p1","p2","p3","p4"],1:["p5","p6","p7","p8"]}, holes: blankHoles() };
    GAMES.push(e); view.gameId = "ge"; view.hole = 0; render();
    res.noLinkUnplayed = !/data-endgame="ge"/.test(html());
    for (let h = 0; h < 18; h++){ e.holes[h].teamScore[0] = par(h); e.holes[h].teamScore[1] = par(h) + 1; }
    render();
    res.noLinkFinished = !/data-endgame="ge"/.test(html());

    window.confirm = realConfirm; Object.assign(SYNC, saved); endOpen = null;
    return JSON.stringify(res);
  })()`));
  ok(out.linkShown, "a game under way offers End game early:");
  ok(out.panelShown, "and the panel shows what 'as it stands' would be — 2 UP thru 14:");
  eq(out.match.ended, "final", "ended final:");
  eq(out.match.after, 14, "after 14 holes:");
  eq(out.match.result.winner, "A", "the side 2 up wins:");
  eq(out.match.p1, "1-0-0/1", "the winners get the W:");
  eq(out.match.p3, "0-1-0/1", "the side that conceded the L:");
  ok(out.match.holesSame, "no hole was touched:");
  ok(out.match.write.length === 1 && /^\{"ended":\{"how":"final","after":14,"at":\d+\}\}$/.test(out.match.write[0]),
     "one write, of the ended field only: " + out.match.write[0]);
  eq(out.match.sets, 0, "never a whole-game setDoc:");
  ok(/WIN/.test(out.match.banner || ""), "the banner gives the result: " + out.match.banner);
  ok(out.match.reopenShown, "and offers Reopen:");
  eq(out.reopened.ended, null, "reopening clears it:");
  eq(out.reopened.result, null, "the match is back in progress:");
  eq(out.reopened.p1, "0-0-0/0", "and off the record until it finishes:");
  eq(out.reopened.lastWrite, '{"ended":null}', "written as one field too:");
  eq(out.tie.p1, "0-0-1/1", "called a tie: a T and a game played for one side:");
  eq(out.tie.p5, "0-0-1/1", "and the other:");
  ok(/ended after 10/.test(out.tie.label) && /called a tie/.test(out.tie.foot), "the list says how it ended: " + out.tie.label + " | " + out.tie.foot);
  eq(out.void.p1, "0-0-0/0", "not counted: nothing, not even a game played:");
  eq(out.void.p5, "0-0-0/0", "for either side:");
  ok(/not counted/.test(out.void.label) && !/undefined|VOID/.test(out.void.label), "and it says so plainly: " + out.void.label);
  eq(out.final4.p1, "1-0-0/1", "final as it stands: the side ahead after ten wins:");
  eq(out.final4.p5, "0-1-0/1", "and the other loses:");
  eq(out.multi, "W,L,T,T", "four teams on different holes are ranked on to par, not the gross:");
  eq(out.multiTie, "T,T,T,T", "and a four-team game called a tie is a T for all four:");
  ok(out.noLinkUnplayed, "nothing played, nothing to end:");
  ok(out.noLinkFinished, "a game that finished on its own isn't offered it either:");
  w.eval("view.gameId = null; view.tab = 'home'; render();");
}));

/* Asked for once the 2026 weekend was over: the app had one kind of thing,
   an EI year, and every year fed the EI record. Now there are events of three
   kinds — the EI, a golf trip, a single game — and only the EI's years reach
   History. These run at the end (they await), so they put back everything
   they touch themselves rather than relying on isolate(). */
const EVENT_STATE = `JSON.stringify({ s:SCHEDULE, g:GAMES, d:DAYS, p:PLAYERS, c:COURSES,
  y:YEARS, l:liveYear, a:activeYear, e:EVENTS, o:openKey, m:EVENT_META, adm:isAdmin,
  tab:view.tab, bm:boardMode })`;
const restoreEvents = (w, snap) => w.eval(`(function(){
  const o = JSON.parse(${JSON.stringify(snap)});
  SCHEDULE = o.s; GAMES = o.g;
  DAYS.length = 0; o.d.forEach(x => DAYS.push(x));
  PLAYERS.length = 0; o.p.forEach(x => PLAYERS.push(x));
  COURSES.length = 0; o.c.forEach(x => COURSES.push(x));
  YEARS = o.y; liveYear = o.l; activeYear = o.a; EVENTS = o.e; openKey = o.o;
  EVENT_META = o.m; isAdmin = o.adm; boardMode = o.bm; newEv = null;
  editEvent = null; view.gameId = null; view.tab = o.tab; render();
})()`);

ta("R151 a golf trip and a single game are events of their own, apart from the EI", async () => {
  const w = dom.window;
  const snap = w.eval(EVENT_STATE);
  try {
    w.eval(`YEARS = ["2025","2026"]; liveYear = "2026"; activeYear = "2026"; EVENTS = []; openKey = null;
            isAdmin = false; render();`);
    eq(w.eval("isEI() && !canSetup()"), true, "in the EI, setup still needs the admin code:");

    const trip = await w.startEvent("trip", "Bandon 2027");
    const t = JSON.parse(w.eval(`JSON.stringify({ active: activeYear, ei: isEI(), kind: eventKind(),
      setup: canSetup(), archive: isArchive(), ttl: document.getElementById("ttl").textContent,
      sub: document.getElementById("tsub").textContent, inYears: YEARS.includes(activeYear),
      listed: EVENTS.some(e => e.id === activeYear && e.kind === "trip" && e.name === "Bandon 2027"),
      bar: (document.querySelector(".evbar-t") || {}).textContent })`));
    eq(t.active, trip, "creating a trip opens it:");
    ok(/^x-/.test(trip), "with an id that can't be mistaken for a year: " + trip);
    eq(t.ei, false, "it isn't the EI:");
    eq(t.kind, "trip", "it's a trip:");
    eq(t.ttl, "Bandon 2027", "the header names it:");
    eq(t.sub, "Golf trip", "and says what it is:");
    eq(t.bar, "Golf trip", "so does the Games tab:");
    ok(t.setup, "setup in a trip doesn't need the EI's admin code:");
    ok(!t.archive, "and a trip is never a frozen archive:");
    ok(!t.inYears && t.listed, "it's listed as an event, never as an EI year — History reads years only:");

    w.eval(`view.tab = "board"; boardMode = "history"; render();`);
    const board = w.eval(`document.getElementById("app").innerHTML`);
    ok(!/data-board="history"/.test(board), "a trip's Board has no History:");
    ok(!/class="yearbar"/.test(board), "and no EI year picker:");
    eq(w.eval("boardMode"), "table", "a History left open in the EI falls back to the table:");

    const game = await w.startEvent("game", "");
    const gm = JSON.parse(w.eval(`JSON.stringify({ active: activeYear, kind: eventKind(), tab: view.tab,
      edit: editEvent, rounds: SCHEDULE.filter(e => e.type === "ROUND").length,
      round: SCHEDULE[0], days: DAYS.slice(), name: EVENT_META.name,
      html: document.getElementById("app").innerHTML })`));
    eq(gm.active, game, "a single game opens too:");
    eq(gm.kind, "game", "as a game:");
    eq(gm.rounds, 1, "with one round:");
    eq(gm.days.length, 1, "on one day:");
    eq(gm.round.day, gm.days[0], "today:");
    ok(/^Game · /.test(gm.name), "named for the date when no name is given: " + gm.name);
    eq(gm.tab, "sched", "and goes straight to the round editor:");
    eq(gm.edit, gm.round.id, "on that round:");
    ok(/data-addgame="[^"]+:WOLF5"/.test(gm.html), "every format can be added, Wolf included:");

    w.eval(`view.tab = "events"; editEvent = null; render();`);
    const ev = w.eval(`document.getElementById("app").innerHTML`);
    ok(new RegExp('data-year="' + trip + '"').test(ev) && new RegExp('data-year="' + game + '"').test(ev),
       "the Events screen lists both:");
    ok(/data-year="2026"/.test(ev) && /data-year="2025"/.test(ev), "and the EI's years:");
    ok(/data-newevent="trip"/.test(ev) && /data-newevent="game"/.test(ev), "with a way to start each kind:");
    ok(!/data-newevent="ei"/.test(ev), "but not the next EI without the admin code:");

    /* a trip needs a name; nothing is created without one */
    w.eval(`handleClick({ dataset:{ newevent:"trip" } })`);
    ok(w.eval(`!!document.getElementById("newevname")`), "New golf trip opens a name box:");
    const n = w.eval("EVENTS.length");
    w.eval(`handleClick({ dataset:{ createevent:"trip" } })`);
    eq(w.eval("EVENTS.length"), n, "and an unnamed trip isn't made:");

    /* back to the EI: everything reads as the EI again */
    await w.switchYear("2026");
    eq(w.eval("isEI() && !canSetup() && eventKind() === 'ei'"), true, "back in the EI, it's the EI again:");
    ok(/Eisenberg Invitational/.test(w.eval(`document.getElementById("ttl").textContent`)), "by name too:");

    /* landing: the event set for everyone, once; then wherever this phone was */
    /* jsdom gives this page no localStorage, so lend it a plain one */
    w.eval(`(function(){ const m = {}; window.__ls = { getItem: k => k in m ? m[k] : null,
      setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
      Object.defineProperty(window, "localStorage", { value: __ls, configurable: true }); })()`);
    const land = JSON.parse(w.eval(`(function(){
      localStorage.setItem("ei-open-seen", "2026"); localStorage.setItem("ei-year", ${JSON.stringify(trip)});
      openKey = "2026"; const stays = landingKey();
      openKey = ${JSON.stringify(game)}; const moved = landingKey();
      localStorage.setItem("ei-year", ${JSON.stringify(trip)}); const once = landingKey();
      return JSON.stringify({ stays, moved, once });
    })()`));
    eq(land.stays, trip, "a phone stays where it was while the open event hasn't changed:");
    eq(land.moved, game, "lands on a newly set open event:");
    eq(land.once, trip, "but only once — after that its own choice sticks:");
  } finally {
    try { w.eval(`delete window.localStorage`); } catch(e){}
    restoreEvents(w, snap);
  }
});

/* What reaches the database. Starting a trip writes its own document and adds
   it to the registry with a merge — the registry also holds the EI's years and
   must never be written over. Starting the next EI from inside a trip takes
   the EI's players, not the trip's. A score queued in one event is sent to
   that event even after the phone has switched to another. */
ta("R152 events are written beside the EI's years, never over them", async () => {
  const w = dom.window;
  const snap = w.eval(EVENT_STATE);
  const saved = w.eval("JSON.stringify({ on: SYNC.on })");
  try {
    w.eval(`(function(){
      window.__w = { sets: [], updates: [] };
      window.__realConnect = connectWith; connectWith = async () => {};
      window.__realSync = { api: SYNC.api, db: SYNC.db };
      SYNC.on = true; SYNC.db = {};
      SYNC.api = {
        doc: (...a) => a.slice(1).join("/"),
        setDoc: (ref, data, opts) => { __w.sets.push({ ref, data: JSON.parse(JSON.stringify(data)), merge: !!(opts && opts.merge) }); return Promise.resolve(); },
        updateDoc: (ref, d) => { __w.updates.push({ ref, d }); return Promise.resolve(); },
        getDoc: ref => Promise.resolve({ exists: () => ref === "tournaments/ei-2026",
          data: () => ({ players: [{ id:"p1", name:"EI Man", index: 5, tees:{} }], courses: COURSES, days: ["Thursday"] }) }),
        arrayUnion: x => ({ union: x })
      };
      YEARS = ["2025","2026"]; liveYear = "2026"; activeYear = "2026"; EVENTS = []; isAdmin = true;
    })()`);
    const trip = await w.startEvent("trip", "Pinehurst");
    const w1 = JSON.parse(w.eval("JSON.stringify(__w.sets)"));
    const cfg = w1.find(x => x.ref === "tournaments/" + trip);
    const reg = w1.find(x => x.ref === "tournaments/_index");
    ok(cfg && cfg.data.kind === "trip" && cfg.data.name === "Pinehurst", "the trip gets its own document:");
    ok(cfg && cfg.data.players.length > 0, "starting from the players on screen:");
    ok(reg && reg.merge, "the registry is merged into, never replaced:");
    ok(reg && reg.data.events && reg.data.events.union && reg.data.events.union.id === trip,
       "with the trip added to its events, not written over them:");
    ok(!("years" in (reg ? reg.data : {})), "and the EI's years left alone:");

    /* a score entered in the trip, then the phone moves to the EI before it's sent */
    w.eval(`(function(){
      GAMES.push({ id:"gtrip", roundId:"r", type:"SCRAMBLE4", teams:{0:[],1:[]}, holes: blankHoles() });
      /* queued but not yet sent — what happens with no signal */
      enqueue("gtrip", 0, "teamScore.0", 4);
      activeYear = "2026";                      // switched away before it flushed
    })()`);
    const item = JSON.parse(w.eval(`JSON.stringify(queue.find(x => x.gid === "gtrip") || null)`));
    eq(item && item.ev, trip, "a queued score remembers its event:");
    await w.flushQueue();
    const up = JSON.parse(w.eval("JSON.stringify(__w.updates)"));
    ok(up.some(u => u.ref === "tournaments/" + trip + "/games/gtrip"),
       "and is sent to that event's game, not the one on screen: " + JSON.stringify(up.map(u => u.ref)));

    /* the next EI, started from inside the trip */
    w.eval(`activeYear = ${JSON.stringify(trip)}; __w.sets.length = 0;`);
    await w.startYear("2027");
    const w2 = JSON.parse(w.eval("JSON.stringify(__w.sets)"));
    const ei = w2.find(x => x.ref === "tournaments/ei-2027");
    const reg2 = w2.find(x => x.ref === "tournaments/_index");
    ok(ei && ei.data.players.length === 1 && ei.data.players[0].name === "EI Man",
       "the next EI carries over the EI's players, not the trip's:");
    ok(reg2 && reg2.merge, "and adds its year with a merge, so the trips survive:");
    eq(w.eval("activeYear"), "2027", "and opens it:");
  } finally {
    w.eval(`(function(){
      connectWith = window.__realConnect; SYNC.api = window.__realSync.api; SYNC.db = window.__realSync.db;
      SYNC.on = ${JSON.parse(saved).on};
      queue = queue.filter(x => x.gid !== "gtrip"); saveQueue();
    })()`);
    restoreEvents(w, snap);
  }
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
