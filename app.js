/* ============================================================
   NFL Pick'em
   Static page + Supabase. No login: each device identifies itself
   with a random id kept in localStorage.

   Data lives in two places:
     slate.json  — games, lines and final scores, committed weekly
     Supabase    — everyone's picks, one row per player per week

   Note: the localStorage keys below are still cfbpickem_* — they are
   deliberately left alone, since renaming them would orphan the player id
   already stored on anyone's device.
   ============================================================ */
(function(){
"use strict";

var CFG = window.CFB_CONFIG || {};
var POLL_MS = CFG.POLL_MS || 20000;

/* STATE keeps the exact shape the render and grading code expects:
     {season, week, games, entries, results, history:[{week,games,results,entries}]}
   so that logic carries over unchanged from the earlier build. */
var STATE = {season: 2026, week: 1, games: [], entries: {}, results: null, history: []};

/* Raw slate.json, and every pick row for the season. */
var SLATE = null;
var ALL_ROWS = [];

/* All 32 NFL clubs, keyed by ESPN's abbreviation so the slate builder's codes
   line up. Anything missing here is filled in automatically from the slate's
   own name/colour fields, so this map is a nicety rather than a dependency. */
var TEAMS = {
  ARI:{name:"Cardinals",primary:"#97233F",secondary:"#FFFFFF"},
  ATL:{name:"Falcons",primary:"#A71930",secondary:"#000000"},
  BAL:{name:"Ravens",primary:"#241773",secondary:"#9E7C0C"},
  BUF:{name:"Bills",primary:"#00338D",secondary:"#C60C30"},
  CAR:{name:"Panthers",primary:"#0085CA",secondary:"#101820"},
  CHI:{name:"Bears",primary:"#0B162A",secondary:"#C83803"},
  CIN:{name:"Bengals",primary:"#FB4F14",secondary:"#000000"},
  CLE:{name:"Browns",primary:"#311D00",secondary:"#FF3C00"},
  DAL:{name:"Cowboys",primary:"#041E42",secondary:"#869397"},
  DEN:{name:"Broncos",primary:"#FB4F14",secondary:"#002244"},
  DET:{name:"Lions",primary:"#0076B6",secondary:"#B0B7BC"},
  GB:{name:"Packers",primary:"#203731",secondary:"#FFB612"},
  HOU:{name:"Texans",primary:"#03202F",secondary:"#A71930"},
  IND:{name:"Colts",primary:"#002C5F",secondary:"#FFFFFF"},
  JAX:{name:"Jaguars",primary:"#006778",secondary:"#D7A22A"},
  KC:{name:"Chiefs",primary:"#E31837",secondary:"#FFB81C"},
  LV:{name:"Raiders",primary:"#000000",secondary:"#A5ACAF"},
  LAC:{name:"Chargers",primary:"#0080C6",secondary:"#FFC20E"},
  LAR:{name:"Rams",primary:"#003594",secondary:"#FFA300"},
  MIA:{name:"Dolphins",primary:"#008E97",secondary:"#FC4C02"},
  MIN:{name:"Vikings",primary:"#4F2683",secondary:"#FFC62F"},
  NE:{name:"Patriots",primary:"#002244",secondary:"#C60C30"},
  NO:{name:"Saints",primary:"#101820",secondary:"#D3BC8D"},
  NYG:{name:"Giants",primary:"#0B2265",secondary:"#A71930"},
  NYJ:{name:"Jets",primary:"#125740",secondary:"#FFFFFF"},
  PHI:{name:"Eagles",primary:"#004C54",secondary:"#A5ACAF"},
  PIT:{name:"Steelers",primary:"#101820",secondary:"#FFB612"},
  SF:{name:"49ers",primary:"#AA0000",secondary:"#B3995D"},
  SEA:{name:"Seahawks",primary:"#002244",secondary:"#69BE28"},
  TB:{name:"Buccaneers",primary:"#D50A0A",secondary:"#34302B"},
  TEN:{name:"Titans",primary:"#0C2340",secondary:"#4B92DB"},
  WSH:{name:"Commanders",primary:"#5A1414",secondary:"#FFB612"}
};


var CATEGORIES = [
  {key:"spread",label:"Spread",kind:"side"},
  {key:"total",label:"Total Points",kind:"ou"},
  {key:"h1Spread",label:"1H Spread",kind:"side"},
  {key:"h1Total",label:"1H Total Points",kind:"ou"},
  {key:"teamTotalAway",label:null,kind:"ou_team",side:"away"},
  {key:"teamTotalHome",label:null,kind:"ou_team",side:"home"}
];


/* ===================== HELPERS ===================== */
function roundHalf(x){ return Math.round(x*2)/2; }
function fmtLine(n){
  if (n === 0) return "PK";
  var sign = n > 0 ? "+" : "-";
  var abs = Math.abs(n);
  var val = (abs % 1 === 0) ? String(abs) : abs.toFixed(1);
  return sign + val;
}
function fmtNum(n){ return (n % 1 === 0) ? String(n) : n.toFixed(1); }
function fmtPts(n){
  if (typeof n !== "number" || isNaN(n)) return "0";
  return (n % 1 === 0) ? String(n) : n.toFixed(1);
}
function deriveLines(g){
  var homeLine = g.spread, margin = Math.abs(homeLine), favIsHome = homeLine < 0;
  var favTotal = (g.total + margin) / 2, dogTotal = (g.total - margin) / 2;
  var homeTeamTotal = roundHalf(favIsHome ? favTotal : dogTotal);
  var awayTeamTotal = roundHalf(favIsHome ? dogTotal : favTotal);
  var h1Spread = roundHalf(homeLine * 0.55);
  var h1Total = roundHalf(g.total * 0.47);
  return {
    homeLine: homeLine, awayLine: -homeLine,
    h1HomeLine: h1Spread, h1AwayLine: -h1Spread,
    total: g.total, h1Total: h1Total,
    homeTeamTotal: homeTeamTotal, awayTeamTotal: awayTeamTotal
  };
}

/* ===================== SUPER DOG / MORTAL OPTIONS ===================== */
function superDogOptions(games){
  var out = [];
  games.forEach(function(g){
    var lines = deriveLines(g);
    if (lines.awayLine >= 4.5) out.push({gameId:g.id, side:"away", team:g.away, opp:g.home, line:lines.awayLine, kickoff:g.kickoff});
    if (lines.homeLine >= 4.5) out.push({gameId:g.id, side:"home", team:g.home, opp:g.away, line:lines.homeLine, kickoff:g.kickoff});
  });
  out.sort(function(a,b){ return b.line - a.line; });
  return out;
}
function mortalOptionsForGame(g){
  var lines = deriveLines(g);
  var favIsHome = lines.homeLine < 0;
  var favSide = favIsHome ? "home" : "away", dogSide = favIsHome ? "away" : "home";
  var favTeam = favIsHome ? g.home : g.away, dogTeam = favIsHome ? g.away : g.home;
  var favLine = favIsHome ? lines.homeLine : lines.awayLine;
  var dogLine = favIsHome ? lines.awayLine : lines.homeLine;
  return {
    favSide: favSide, dogSide: dogSide, favTeam: favTeam, dogTeam: dogTeam,
    favAdjLine: favLine < 0 ? roundHalf(favLine + 6) : null,
    dogAdjLine: favLine < 0 ? roundHalf(dogLine + 6) : null,
    overAdjLine: roundHalf(lines.total - 6),
    underAdjLine: roundHalf(lines.total + 6)
  };
}
function uid(){ return "p" + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function fmtKickoff(iso){
  var d = new Date(iso);
  var dateStr = d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
  var timeStr = d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  return dateStr + " · " + timeStr;
}
function isLocked(iso){ return new Date() >= new Date(iso); }


/* ===================== STATE HELPERS ===================== */
function cloneState(s){ return JSON.parse(JSON.stringify(s)); }
function getEntry(state, playerId){
  if (!state.entries) state.entries = {};
  if (!state.entries[playerId]) state.entries[playerId] = {name:"", picks:{}, superDog:null, mortal:null, updatedAt:null};
  return state.entries[playerId];
}
function scoreOf(entry){
  var n = 0;
  for (var gid in entry.picks){
    var p = entry.picks[gid];
    for (var k in p){ if (p[k]) n++; }
  }
  return n;
}


/* ===================== GRADING ===================== */
/* A result is {a:awayFinal, h:homeFinal, a1:awayFirstHalf, h1:homeFirstHalf}.
   Half-time numbers are optional; 1H picks stay ungraded without them. */

var WIN = "win", LOSS = "loss", PUSH = "push";

function gradeSide(pick, awayPts, homePts, homeLine){
  if (!pick) return null;
  var adj = (homePts - awayPts) + homeLine;
  if (adj === 0) return PUSH;
  var winner = adj > 0 ? "home" : "away";
  return pick === winner ? WIN : LOSS;
}
function gradeOU(pick, points, line){
  if (!pick) return null;
  if (points === line) return PUSH;
  var winner = points > line ? "over" : "under";
  return pick === winner ? WIN : LOSS;
}
function catPoints(outcome){
  if (outcome === WIN) return 1;
  if (outcome === PUSH) return 0.5;
  return 0;
}

/* Grades every standard category of one game. Returns {cat: outcome|null}. */
function gradeGamePicks(g, r, picks){
  var out = {};
  if (!picks) picks = {};
  var lines = deriveLines(g);
  var hasFull = r && typeof r.a === "number" && typeof r.h === "number";
  var hasHalf = r && typeof r.a1 === "number" && typeof r.h1 === "number";
  if (hasFull){
    out.spread = gradeSide(picks.spread, r.a, r.h, lines.homeLine);
    out.total = gradeOU(picks.total, r.a + r.h, lines.total);
    out.teamTotalAway = gradeOU(picks.teamTotalAway, r.a, lines.awayTeamTotal);
    out.teamTotalHome = gradeOU(picks.teamTotalHome, r.h, lines.homeTeamTotal);
  }
  if (hasHalf){
    out.h1Spread = gradeSide(picks.h1Spread, r.a1, r.h1, lines.h1HomeLine);
    out.h1Total = gradeOU(picks.h1Total, r.a1 + r.h1, lines.h1Total);
  }
  return out;
}

function gradeSuperDog(sd, gamesById, results){
  if (!sd) return null;
  var g = gamesById[sd.gameId];
  var r = results && results[sd.gameId];
  if (!g || !r || typeof r.a !== "number" || typeof r.h !== "number") return null;
  var lines = deriveLines(g);
  var line = sd.side === "home" ? lines.homeLine : lines.awayLine;
  var dogPts = sd.side === "home" ? r.h : r.a;
  var oppPts = sd.side === "home" ? r.a : r.h;
  if (dogPts > oppPts) return {outcome:"outright", points: 5 + line};
  var adj = (dogPts + line) - oppPts;
  if (adj > 0) return {outcome:WIN, points:5};
  if (adj === 0) return {outcome:PUSH, points:1};
  return {outcome:LOSS, points:0};
}

function gradeMortal(mo, gamesById, results){
  if (!mo) return null;
  var g = gamesById[mo.gameId];
  var r = results && results[mo.gameId];
  if (!g || !r || typeof r.a !== "number" || typeof r.h !== "number") return null;
  var m = mortalOptionsForGame(g);
  var outcome;
  if (mo.type === "spread"){
    if (m.favAdjLine === null) return null;
    var adjLine = (mo.side === m.favSide) ? m.favAdjLine : m.dogAdjLine;
    var myPts = mo.side === "home" ? r.h : r.a;
    var oppPts = mo.side === "home" ? r.a : r.h;
    var diff = (myPts + adjLine) - oppPts;
    outcome = diff === 0 ? PUSH : (diff > 0 ? WIN : LOSS);
  } else {
    var pts = r.a + r.h;
    var lineUsed = mo.side === "over" ? m.overAdjLine : m.underAdjLine;
    if (pts === lineUsed) outcome = PUSH;
    else if (mo.side === "over") outcome = pts > lineUsed ? WIN : LOSS;
    else outcome = pts < lineUsed ? WIN : LOSS;
  }
  return {outcome: outcome, points: catPoints(outcome)};
}

/* Full scorecard for one player in one week. */
function gradeEntry(games, results, entry){
  var gamesById = {};
  (games || []).forEach(function(g){ gamesById[g.id] = g; });
  var detail = {}, standard = 0, graded = 0;
  (games || []).forEach(function(g){
    var r = results && results[g.id];
    if (!r) return;
    var picks = (entry.picks && entry.picks[g.id]) || {};
    var res = gradeGamePicks(g, r, picks);
    detail[g.id] = res;
    for (var k in res){
      if (res[k]){ standard += catPoints(res[k]); graded++; }
    }
  });
  var sd = gradeSuperDog(entry.superDog, gamesById, results);
  var mo = gradeMortal(entry.mortal, gamesById, results);
  return {
    detail: detail,
    standard: standard,
    superDog: sd ? sd.points : 0,
    superDogOutcome: sd,
    mortal: mo ? mo.points : 0,
    mortalOutcome: mo,
    total: standard + (sd ? sd.points : 0) + (mo ? mo.points : 0),
    gradedCount: graded
  };
}

function hasResults(results){
  if (!results) return false;
  for (var k in results) return true;
  return false;
}


/* Every week with picks, newest first: current week then archived history. */
function allWeeks(){
  var out = [{
    week: STATE.week || 1,
    games: STATE.games || [],
    results: STATE.results || null,
    entries: STATE.entries || {}
  }];
  (STATE.history || []).forEach(function(w){ out.push(w); });
  return out;
}

/* Cumulative season points per player across every completed week. */
function seasonTotals(){
  var totals = {};
  allWeeks().forEach(function(w){
    if (!hasResults(w.results)) return;
    for (var pid in w.entries){
      var e = w.entries[pid];
      var sc = gradeEntry(w.games, w.results, e);
      if (!totals[pid]) totals[pid] = {id:pid, name:e.name || "Anonymous", standard:0, superDog:0, mortal:0, total:0, weeks:0};
      totals[pid].name = e.name || totals[pid].name;
      totals[pid].standard += sc.standard;
      totals[pid].superDog += sc.superDog;
      totals[pid].mortal += sc.mortal;
      totals[pid].total += sc.total;
      totals[pid].weeks++;
    }
  });
  /* Players who have joined but have no graded week yet still belong on the board. */
  for (var pid2 in (STATE.entries || {})){
    if (!totals[pid2]){
      var en = STATE.entries[pid2];
      totals[pid2] = {id:pid2, name:en.name || "Anonymous", standard:0, superDog:0, mortal:0, total:0, weeks:0};
    }
  }
  return Object.keys(totals).map(function(k){ return totals[k]; })
    .sort(function(a,b){ return b.total - a.total; });
}


/* ===================== LOCAL PLAYER ===================== */
function getPlayer(){
  var id = null, name = null;
  try { id = localStorage.getItem("cfbpickem_id"); name = localStorage.getItem("cfbpickem_name"); } catch(e){}
  if (!id){ id = uid(); try{ localStorage.setItem("cfbpickem_id", id); }catch(e){} }
  return {id: id, name: name};
}
function savePlayerName(name){
  try{ localStorage.setItem("cfbpickem_name", name); }catch(e){}
}

/* Take over an existing player's identity on this device, so the same person
   on a phone and a laptop is one entry rather than two. The cached card below
   belongs to the id we are leaving behind, so it must go — otherwise it would
   be reapplied on top of the card we just adopted. */
function adoptPlayerId(id){
  try{
    localStorage.setItem("cfbpickem_id", id);
    localStorage.removeItem(MY_ENTRY_KEY);
  }catch(e){}
}

/* Each device keeps a copy of its own card so a dropped connection or a
   failed write never loses picks the player already made. */
var MY_ENTRY_KEY = "cfbpickem_entry_v2";
function rememberMyEntry(entry, week){
  try{ localStorage.setItem(MY_ENTRY_KEY, JSON.stringify({week: week, entry: entry})); }catch(e){}
}
function recallMyEntry(week){
  try{
    var raw = localStorage.getItem(MY_ENTRY_KEY);
    if (!raw) return null;
    var saved = JSON.parse(raw);
    if (!saved || saved.week !== week || !saved.entry) return null;
    return saved.entry;
  }catch(e){ return null; }
}
function entryIsNewer(mine, theirs){
  if (!mine) return false;
  if (!theirs) return true;
  if (!theirs.updatedAt) return !!mine.updatedAt;
  if (!mine.updatedAt) return false;
  return mine.updatedAt > theirs.updatedAt;
}


/* ===================== SUPABASE DATA LAYER ===================== */
/* PostgREST over plain fetch — no SDK, so there is no CDN to fail and
   nothing to keep in sync with a library version. */

/* Accept either the project URL or the full REST endpoint — the dashboard
   shows the latter, and pasting it is the obvious mistake to make. */
function normalizeBase(u){
  return String(u || "").trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "");
}
var SB_BASE = normalizeBase(CFG.SUPABASE_URL);

var SB_READY = !!(SB_BASE && CFG.SUPABASE_ANON_KEY &&
                  SB_BASE.indexOf("__") === -1 &&
                  String(CFG.SUPABASE_ANON_KEY).indexOf("__") === -1);

/* Two Supabase key formats are in circulation: legacy anon keys (a JWT
   starting "eyJ") and newer publishable keys ("sb_publishable_..."). The
   legacy flow expects the key in both `apikey` and `Authorization: Bearer`,
   but a non-JWT value in Authorization can be rejected as a malformed token.
   Rather than guess, send both and — on a 401/403 — retry once with `apikey`
   alone, then remember whichever form the project accepted. */
var AUTH_MODE = "both";
var authSettled = false;

function sbHeaders(extra, mode){
  var key = CFG.SUPABASE_ANON_KEY;
  var h = {"apikey": key, "Content-Type": "application/json"};
  if ((mode || AUTH_MODE) === "both") h["Authorization"] = "Bearer " + key;
  for (var k in (extra || {})) h[k] = extra[k];
  return h;
}

function sbFetch(path, init){
  init = init || {};
  function attempt(mode){
    var o = {method: init.method || "GET", headers: sbHeaders(init.headers, mode)};
    if (init.body) o.body = init.body;
    return fetch(sbUrl(path), o);
  }
  return attempt(AUTH_MODE).then(function(r){
    if (r.ok){ authSettled = true; return r; }
    if ((r.status === 401 || r.status === 403) && !authSettled){
      var alt = (AUTH_MODE === "both") ? "apikey" : "both";
      return attempt(alt).then(function(r2){
        if (r2.ok){ AUTH_MODE = alt; authSettled = true; }
        return r2;
      });
    }
    return r;
  });
}

function sbUrl(path){
  return SB_BASE + "/rest/v1/" + path;
}

/* One pick row from the database -> the entry shape the UI renders. */
function rowToEntry(row){
  return {
    name: row.player_name || "",
    picks: row.picks || {},
    superDog: row.super_dog || null,
    mortal: row.mortal || null,
    updatedAt: row.updated_at || null
  };
}

/* `no-cache` forces the browser to revalidate with the ETag rather than serve
   a stale copy. When nothing has changed GitHub Pages answers 304 with no
   body, so polling this is nearly free — unlike a cache-busting query string,
   which would force a full download every time. */
function loadSlate(){
  return fetch("slate.json", {cache: "no-cache"})
    .then(function(r){
      if (!r.ok) throw new Error("slate.json returned " + r.status);
      return r.json();
    });
}

/* Changes worth redrawing for: a new week, different games, or new scores. */
function slateFingerprint(sl){
  if (!sl) return "";
  var wk = String(sl.currentWeek);
  var cur = (sl.weeks || {})[wk] || {};
  var res = cur.results || {};
  var scored = Object.keys(res).sort().map(function(id){
    var r = res[id];
    return id + ":" + r.a + "-" + r.h + "/" + (r.a1 === undefined ? "" : r.a1 + "-" + r.h1);
  }).join(",");
  return wk + "|" + (cur.games || []).length + "|" + scored;
}

function loadPicks(season){
  if (!SB_READY) return Promise.resolve([]);
  return sbFetch("picks?season=eq." + season + "&select=*")
    .then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error("picks read " + r.status + ": " + t); });
      return r.json();
    });
}

/* Teams the built-in TEAMS map doesn't know about — anyone newly ranked, any
   unranked opponent — are filled in from whatever the slate carries, so a new
   matchup never renders as a bare abbreviation and nobody has to hand-edit a
   colour table mid-season. Hand-curated entries always win. */
function absorbTeams(games){
  (games || []).forEach(function(g){
    ["away", "home"].forEach(function(side){
      var key = g[side];
      if (!key || TEAMS[key]) return;
      TEAMS[key] = {
        name: g[side + "Name"] || key,
        primary: g[side + "Color"] || "#2b3138",
        secondary: g[side + "Alt"] || "#ffffff"
      };
    });
  });
}

/* Rebuild STATE from the slate plus every pick row for the season. */
function rebuildState(){
  var season = SLATE.season;
  var week = SLATE.currentWeek;
  var weeks = SLATE.weeks || {};
  var cur = weeks[String(week)] || {games: [], results: null};

  var byWeek = {};
  ALL_ROWS.forEach(function(row){
    var w = String(row.week);
    if (!byWeek[w]) byWeek[w] = {};
    byWeek[w][row.player_id] = rowToEntry(row);
  });

  Object.keys(weeks).forEach(function(w){ absorbTeams(weeks[w].games); });

  STATE.season = season;
  STATE.week = week;
  STATE.games = cur.games || [];
  STATE.results = cur.results || null;
  STATE.entries = byWeek[String(week)] || {};

  /* Completed weeks, newest first, for the season leaderboard. */
  STATE.history = Object.keys(weeks)
    .map(Number)
    .filter(function(w){ return w !== week; })
    .sort(function(a, b){ return b - a; })
    .map(function(w){
      return {
        week: w,
        games: weeks[String(w)].games || [],
        results: weeks[String(w)].results || null,
        entries: byWeek[String(w)] || {}
      };
    });
}

/* ---------- writing ---------- */

var saveTimer = null, saving = false, pendingEntry = null, retryCount = 0, retryTimer = null;

function scheduleSave(newState){
  var me = getPlayer();
  var entry = (newState.entries || {})[me.id];
  if (!entry) return;
  pendingEntry = entry;
  rememberMyEntry(entry, STATE.week);
  setStatus("saving");
  if (saveTimer) clearTimeout(saveTimer);
  if (retryTimer){ clearTimeout(retryTimer); retryTimer = null; }
  retryCount = 0;
  saveTimer = setTimeout(doSave, 400);
}

function setStatus(mode, detail){
  var el = document.getElementById("sync-status");
  if (!el) return;
  if (mode === "saving") el.textContent = "Saving…";
  else if (mode === "saved") el.textContent = "Saved";
  else if (mode === "offline") el.innerHTML =
    "Offline — your picks are saved on this device and will sync by themselves. " +
    "<button type=\"button\" class=\"retry-link\" id=\"retry-btn\">Retry now</button>";
  else if (mode === "setup") el.textContent = "Not connected to a database yet — picks won’t be shared.";
  else if (mode === "error") el.innerHTML =
    "Save failed" + (detail ? " (" + escapeHtml(detail) + ")" : "") +
    " — <button type=\"button\" class=\"retry-link\" id=\"retry-btn\">Retry</button>";
  else el.textContent = "";
  var rb = document.getElementById("retry-btn");
  if (rb) rb.addEventListener("click", function(){ retryCount = 0; doSave(); });
}

function doSave(){
  if (!pendingEntry) return;
  if (!SB_READY){ setStatus("setup"); return; }
  if (saving){ setTimeout(doSave, 300); return; }
  saving = true;

  var me = getPlayer();
  var entry = pendingEntry;
  var body = [{
    season: STATE.season,
    week: STATE.week,
    player_id: me.id,
    player_name: entry.name || me.name || "Anonymous",
    picks: entry.picks || {},
    super_dog: entry.superDog || null,
    mortal: entry.mortal || null,
    updated_at: new Date().toISOString()
  }];

  sbFetch("picks", {
    method: "POST",
    headers: {"Prefer": "resolution=merge-duplicates,return=minimal"},
    body: JSON.stringify(body)
  }).then(function(r){
    saving = false;
    if (!r.ok){
      return r.text().then(function(t){ handleSaveError(r.status + ": " + t); });
    }
    retryCount = 0;
    setStatus("saved");
    setTimeout(function(){
      /* Clear the "Saved" note, but don't stomp a newer message. */
      var el = document.getElementById("sync-status");
      if (el && el.textContent === "Saved") el.textContent = "";
    }, 2000);
  }).catch(function(err){
    saving = false;
    handleSaveError(err && err.message ? err.message : "network");
  });
}

function handleSaveError(detail){
  var offline = (typeof navigator !== "undefined" && navigator.onLine === false) ||
                /network|failed to fetch|disconnected/i.test(String(detail));

  /* Say so straight away rather than sitting on "Saving…" through the whole
     backoff — an unexplained spinner reads like lost picks. Retries continue
     underneath the message. */
  if (offline) setStatus("offline");

  if (retryCount < 5){
    retryCount++;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(doSave, Math.min(1000 * retryCount, 5000));
    if (!offline) setStatus("saving");
  } else if (!offline){
    setStatus("error", detail);
  }
}

/* Retry automatically when the device comes back online. */
if (typeof window !== "undefined" && window.addEventListener){
  window.addEventListener("online", function(){
    if (pendingEntry){ retryCount = 0; doSave(); }
  });
}

/* ---------- polling ---------- */

var pollTimer = null;
function startPolling(){
  if (!SB_READY) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function(){
    if (document.hidden) return;
    if (saving) return;
    refreshPicks();
  }, POLL_MS);
}

/* A poll must never redraw the page under someone's finger: re-rendering
   replaces every button, so a tap landing mid-refresh would hit a detached
   element and be lost. So we only redraw when the data actually changed, and
   never within a moment of the player touching something. */
var lastTouch = 0;
function noteInteraction(){ lastTouch = Date.now(); }
if (typeof document !== "undefined" && document.addEventListener){
  document.addEventListener("pointerdown", noteInteraction, true);
  document.addEventListener("keydown", noteInteraction, true);
}

function entriesFingerprint(){
  var ids = Object.keys(STATE.entries).sort();
  return ids.map(function(id){
    var e = STATE.entries[id];
    return id + ":" + (e.name || "") + ":" + (e.updatedAt || "") +
           ":" + scoreOf(e) + ":" + (e.superDog ? 1 : 0) + ":" + (e.mortal ? 1 : 0);
  }).join("|");
}

/* Pull everyone's picks again, keeping this device's own entry authoritative
   so a poll landing mid-edit can never roll back what the player just tapped. */
function refreshPicks(){
  /* Re-read the slate as well as the picks: scores are committed to
     slate.json through the evening, and without this they would only appear
     when someone reloaded the page by hand. */
  return Promise.all([
    loadPicks(STATE.season),
    loadSlate().catch(function(){ return null; })
  ]).then(function(res){
    var rows = res[0], freshSlate = res[1];

    var beforeEntries = entriesFingerprint();
    var beforeSlate = slateFingerprint(SLATE);

    var me = getPlayer();
    var mine = STATE.entries[me.id];
    ALL_ROWS = rows;
    if (freshSlate && slateFingerprint(freshSlate) !== beforeSlate) SLATE = freshSlate;
    rebuildState();
    if (mine && entryIsNewer(mine, STATE.entries[me.id])) STATE.entries[me.id] = mine;

    var changed = entriesFingerprint() !== beforeEntries ||
                  slateFingerprint(SLATE) !== beforeSlate;
    if (!changed) return;                                 // nothing new to show
    if (Date.now() - lastTouch < 1500) return;            // they're mid-tap
    renderApp();
  }).catch(function(){ /* a failed poll is not worth interrupting anyone over */ });
}


/* ===================== RENDER ===================== */
var currentIndex = 0;
var activeTab = "picks";
var viewingPlayerId = null;
var boardScope = "week";

var pendingName = null, pendingMatches = null;

function renderApp(){
  var root = document.getElementById("app");
  var player = getPlayer();
  if (pendingName && pendingMatches && pendingMatches.length){
    root.innerHTML = renderClaimPrompt(pendingName, pendingMatches);
    wireClaimPrompt();
    return;
  }
  if (!player.name){
    root.innerHTML = renderNamePrompt();
    wireNamePrompt();
    return;
  }
  root.innerHTML = renderShell(player);
  wireShell(player);
}

/* Who, if anyone, is already picking under this name. Identity is per device,
   so the same person on a phone and a laptop would otherwise become two
   players; this is what lets the second device claim the first one's card. */
function playersNamed(name){
  var want = String(name || "").trim().toLowerCase();
  if (!want) return [];
  var entries = STATE.entries || {};
  return Object.keys(entries)
    .filter(function(id){
      return String(entries[id].name || "").trim().toLowerCase() === want;
    })
    .map(function(id){ return {id: id, entry: entries[id]}; });
}

function renderNamePrompt(){
  return '' +
  '<div class="name-gate">' +
    '<div class="name-card">' +
      '<div class="name-emoji">🏈</div>' +
      '<h1>NFL Pick’em</h1>' +
      '<p>Enter a name so your friends can see your picks on the board.</p>' +
      '<input id="name-input" type="text" maxlength="24" placeholder="Your name" autocomplete="off">' +
      '<button id="name-save" class="btn-primary">Let’s go</button>' +
    '</div>' +
  '</div>';
}

/* Shown when the typed name is already on the board: is this the same person
   coming back on another device, or a different friend with the same name? */
function renderClaimPrompt(name, matches){
  var m = matches[0];
  var n = scoreOf(m.entry);
  var made = n
    ? n + ' pick' + (n === 1 ? '' : 's') + ' already in'
    : 'no picks yet';
  var extras = (m.entry.superDog ? ' · Super Dog set' : '') +
               (m.entry.mortal ? ' · Mortal set' : '');
  return '' +
  '<div class="name-gate">' +
    '<div class="name-card">' +
      '<div class="name-emoji">👀</div>' +
      '<h1>Already picking as ' + escapeHtml(name) + '</h1>' +
      '<p>Someone is on the board under that name — ' + made + extras + '.<br>' +
        'If that\u2019s you on another device, pick up where you left off.</p>' +
      '<button id="claim-yes" class="btn-primary">That\u2019s me — load my picks</button>' +
      '<button id="claim-no" class="btn-secondary">I\u2019m a different ' + escapeHtml(name) + '</button>' +
    '</div>' +
  '</div>';
}
function startAs(name){
  savePlayerName(name);
  var player = getPlayer();
  var ns = cloneState(STATE);
  var entry = getEntry(ns, player.id);
  entry.name = name;
  entry.updatedAt = new Date().toISOString();
  STATE.entries = ns.entries;
  renderApp();
  scheduleSave(ns);
}

function wireNamePrompt(){
  var input = document.getElementById("name-input");
  var btn = document.getElementById("name-save");
  input.focus();
  function submit(){
    var v = input.value.trim();
    if (!v) { input.focus(); return; }
    var matches = playersNamed(v);
    if (matches.length){
      pendingName = v;
      pendingMatches = matches;
      renderApp();
      return;
    }
    startAs(v);
  }
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", function(e){ if (e.key === "Enter") submit(); });
}

function wireClaimPrompt(){
  var yes = document.getElementById("claim-yes");
  var no = document.getElementById("claim-no");

  if (yes) yes.addEventListener("click", function(){
    /* Adopt the existing player's id so both devices are one entry. The
       device-local card cache belongs to the old id, so drop it rather than
       let it resurrect over the claimed one. */
    var target = pendingMatches[0];
    adoptPlayerId(target.id);
    savePlayerName(target.entry.name || pendingName);
    pendingName = null; pendingMatches = null;
    renderApp();
  });

  if (no) no.addEventListener("click", function(){
    /* Distinct person, same name: keep them apart on the board. */
    var base = pendingName, n = 2, taken;
    do {
      taken = playersNamed(base + " (" + n + ")").length;
      if (taken) n++;
    } while (taken && n < 50);
    var unique = base + " (" + n + ")";
    pendingName = null; pendingMatches = null;
    startAs(unique);
  });
}

function renderShell(player){
  var games = STATE.games || [];
  return '' +
  '<div class="topbar safe-top">' +
    '<div class="brand">🏈 <span>NFL Pick’em</span>' +
      '<em class="week-chip">Week ' + (STATE.week || 1) + '</em>' +
    '</div>' +
    '<button id="name-chip" class="name-chip">' + escapeHtml(player.name) + '</button>' +
  '</div>' +
  '<div class="tabs">' +
    '<button class="tab-btn ' + (activeTab==="picks"?"active":"") + '" data-tab="picks">Picks</button>' +
    '<button class="tab-btn ' + (activeTab==="extra"?"active":"") + '" data-tab="extra">Super Dog &amp; Mortal</button>' +
    '<button class="tab-btn ' + (activeTab==="board"?"active":"") + '" data-tab="board">Leaderboard</button>' +
  '</div>' +
  '<div id="tab-picks" style="display:' + (activeTab==="picks"?"block":"none") + '">' +
    renderCarousel(games, player) +
  '</div>' +
  '<div id="tab-extra" style="display:' + (activeTab==="extra"?"block":"none") + '">' +
    renderExtraPicks(games, player) +
  '</div>' +
  '<div id="tab-board" style="display:' + (activeTab==="board"?"block":"none") + '">' +
    renderLeaderboard() +
  '</div>' +
  '<div class="footer-status safe-bottom"><span id="sync-status"></span></div>' +
  (viewingPlayerId ? renderPlayerModal(viewingPlayerId) : '');
}

function renderPlayerModal(playerId){
  var entries = STATE.entries || {};
  var entry = entries[playerId];
  if (!entry) return '';
  var games = STATE.games || [];
  var results = STATE.results || null;
  var card = gradeEntry(games, results, entry);
  var byId = {};
  games.forEach(function(g){ byId[g.id] = g; });

  function mark(outcome){
    if (outcome === WIN) return '<i class="pd-mark win">✓</i>';
    if (outcome === LOSS) return '<i class="pd-mark loss">✕</i>';
    if (outcome === PUSH) return '<i class="pd-mark push">=</i>';
    return '';
  }
  function pickLabel(picks, cat, awayKey, homeKey, awayLine, homeLine, graded){
    var v = picks[cat];
    if (!v) return '<span class="pd-none">—</span>';
    var teamKey = v === "away" ? awayKey : homeKey;
    var line = v === "away" ? awayLine : homeLine;
    return '<b>' + escapeHtml((TEAMS[teamKey]||{name:teamKey}).name) + " " + fmtLine(line) + mark(graded && graded[cat]) + '</b>';
  }
  function ouLabel(picks, cat, line, graded){
    var v = picks[cat];
    if (!v) return '<span class="pd-none">—</span>';
    return '<b>' + (v === "over" ? "Over " : "Under ") + fmtNum(line) + mark(graded && graded[cat]) + '</b>';
  }

  var rows = games.map(function(g){
    var picks = (entry.picks && entry.picks[g.id]) || {};
    var gr = card.detail[g.id] || null;
    var lines = deriveLines(g);
    var r = results && results[g.id];
    var awayT = (TEAMS[g.away]||{name:g.away}).name, homeT = (TEAMS[g.home]||{name:g.home}).name;
    var finalStr = (r && typeof r.a === "number")
      ? '<span class="pd-final">' + r.a + '–' + r.h + '</span>' : '';
    return '<div class="pd-game">' +
      '<div class="pd-vs">' + escapeHtml(awayT) + ' at ' + escapeHtml(homeT) + finalStr + '</div>' +
      '<div class="pd-row"><span>Spread</span>' + pickLabel(picks, "spread", g.away, g.home, lines.awayLine, lines.homeLine, gr) + '</div>' +
      '<div class="pd-row"><span>Total</span>' + ouLabel(picks, "total", lines.total, gr) + '</div>' +
      '<div class="pd-row"><span>1H Spread</span>' + pickLabel(picks, "h1Spread", g.away, g.home, lines.h1AwayLine, lines.h1HomeLine, gr) + '</div>' +
      '<div class="pd-row"><span>1H Total</span>' + ouLabel(picks, "h1Total", lines.h1Total, gr) + '</div>' +
      '<div class="pd-row"><span>' + escapeHtml(awayT) + ' Total</span>' + ouLabel(picks, "teamTotalAway", lines.awayTeamTotal, gr) + '</div>' +
      '<div class="pd-row"><span>' + escapeHtml(homeT) + ' Total</span>' + ouLabel(picks, "teamTotalHome", lines.homeTeamTotal, gr) + '</div>' +
    '</div>';
  }).join("");

  var sdLabel = "—";
  if (entry.superDog){
    var gsd = byId[entry.superDog.gameId];
    if (gsd){
      var lsd = deriveLines(gsd);
      var teamKey = entry.superDog.side === "home" ? gsd.home : gsd.away;
      var line = entry.superDog.side === "home" ? lsd.homeLine : lsd.awayLine;
      sdLabel = escapeHtml((TEAMS[teamKey]||{name:teamKey}).name) + " " + fmtLine(line);
    }
  }
  var moLabel = "—";
  if (entry.mortal){
    var gmo = byId[entry.mortal.gameId];
    if (gmo){
      var m = mortalOptionsForGame(gmo);
      if (entry.mortal.type === "spread"){
        var teamKey2 = entry.mortal.side === m.favSide ? m.favTeam : m.dogTeam;
        var adjLine = entry.mortal.side === m.favSide ? m.favAdjLine : m.dogAdjLine;
        moLabel = escapeHtml((TEAMS[teamKey2]||{name:teamKey2}).name) + " " + fmtLine(adjLine);
      } else {
        var adj = entry.mortal.side === "over" ? m.overAdjLine : m.underAdjLine;
        moLabel = (entry.mortal.side === "over" ? "Over " : "Under ") + fmtNum(adj);
      }
    }
  }

  var season = null;
  seasonTotals().forEach(function(t){ if (t.id === playerId) season = t; });
  var sdMark = card.superDogOutcome
    ? mark(card.superDogOutcome.outcome === "outright" ? WIN : card.superDogOutcome.outcome) : '';
  var moMark = card.mortalOutcome ? mark(card.mortalOutcome.outcome) : '';
  var graded = hasResults(results);
  var summary = graded
    ? '<div class="pd-summary">Week ' + (STATE.week || 1) + ': <b>' + fmtPts(card.total) + ' pts</b>' +
      ' <span>(' + fmtPts(card.standard) + ' picks · ' + fmtPts(card.superDog) + ' dog · ' + fmtPts(card.mortal) + ' mortal)</span>' +
      (season ? '<br>Season: <b>' + fmtPts(season.total) + ' pts</b>' : '') + '</div>'
    : '<div class="pd-summary">Week ' + (STATE.week || 1) + ' — not graded yet' +
      (season && season.weeks ? '<br>Season so far: <b>' + fmtPts(season.total) + ' pts</b>' : '') + '</div>';

  return '' +
  '<div class="modal-backdrop" id="pd-backdrop">' +
    '<div class="modal-sheet">' +
      '<div class="modal-head">' +
        '<h2>' + escapeHtml(entry.name || "Player") + '’s picks</h2>' +
        '<button type="button" class="modal-close" id="pd-close" aria-label="Close">✕</button>' +
      '</div>' +
      summary +
      '<div class="pd-extra">' +
        '<div class="pd-extra-row"><span>Super Dog</span><b>' + sdLabel + sdMark + '</b></div>' +
        '<div class="pd-extra-row"><span>Mortal</span><b>' + moLabel + moMark + '</b></div>' +
      '</div>' +
      '<div class="pd-games">' + (rows || '<div class="empty">No games loaded.</div>') + '</div>' +
    '</div>' +
  '</div>';
}

function renderCarousel(games, player){
  if (!games.length) return '<div class="empty">No games loaded for this week yet.</div>';
  if (currentIndex >= games.length) currentIndex = games.length - 1;
  if (currentIndex < 0) currentIndex = 0;
  var g = games[currentIndex];
  var dots = games.map(function(gm, i){
    return '<span class="dot ' + (i===currentIndex?"on":"") + '"></span>';
  }).join("");
  return '' +
    '<div class="carousel">' +
      '<button id="prev-btn" class="nav-btn" ' + (currentIndex===0?"disabled":"") + ' aria-label="Previous game">‹</button>' +
      '<div class="card-wrap">' + renderGameCard(g, player) + '</div>' +
      '<button id="next-btn" class="nav-btn" ' + (currentIndex===games.length-1?"disabled":"") + ' aria-label="Next game">›</button>' +
    '</div>' +
    '<div class="dots">' + dots + '</div>' +
    '<div class="counter">Game ' + (currentIndex+1) + ' of ' + games.length + '</div>';
}

function teamBadge(key){
  var t = TEAMS[key] || {name:key, primary:"#333", secondary:"#999"};
  return '<span class="badge" style="background:' + t.primary + ';color:' + t.secondary + ';border-color:' + t.secondary + '">' + escapeHtml(key) + '</span>';
}

function renderGameCard(g, player){
  var lines = deriveLines(g);
  var locked = isLocked(g.kickoff);
  var entry = getEntry(STATE, player.id);
  var picks = (entry.picks && entry.picks[g.id]) || {};
  var awayT = TEAMS[g.away] || {name:g.away}, homeT = TEAMS[g.home] || {name:g.home};

  var rows = [
    rowSide(g, "spread", "Spread", g.away, g.home, lines.awayLine, lines.homeLine, picks.spread, locked),
    rowOU(g, "total", "Total Points", lines.total, picks.total, locked),
    rowSide(g, "h1Spread", "1H Spread", g.away, g.home, lines.h1AwayLine, lines.h1HomeLine, picks.h1Spread, locked),
    rowOU(g, "h1Total", "1H Total Points", lines.h1Total, picks.h1Total, locked),
    rowOU(g, "teamTotalAway", awayT.name + " Total", lines.awayTeamTotal, picks.teamTotalAway, locked),
    rowOU(g, "teamTotalHome", homeT.name + " Total", lines.homeTeamTotal, picks.teamTotalHome, locked)
  ].join("");

  return '' +
  '<div class="card" data-game="' + g.id + '">' +
    '<div class="card-head">' +
      '<span class="kickoff">' + fmtKickoff(g.kickoff) + (g.network ? ' · ' + g.network : '') + '</span>' +
      (locked ? '<span class="lock-tag">Locked</span>' : '<span class="open-tag">Open</span>') +
    '</div>' +
    '<div class="matchup">' +
      teamRow(g.away, g.awayRank) +
      '<div class="at-line"><span>AT</span><div class="rule"></div></div>' +
      teamRow(g.home, g.homeRank) +
    '</div>' +
    (g.note ? '<div class="note">' + escapeHtml(g.note) + '</div>' : '') +
    '<div class="rows">' + rows + '</div>' +
  '</div>';
}

function teamRow(key, rank){
  var t = TEAMS[key] || {name:key};
  return '<div class="team-row">' +
    teamBadge(key) +
    (rank ? '<span class="rank">' + rank + '</span>' : '') +
    '<span class="team-name">' + escapeHtml(t.name) + '</span>' +
  '</div>';
}

function pickBtn(gameId, cat, value, label, selected, locked){
  var cls = "pick-btn" + (selected ? " selected" : "") + (locked ? " locked" : "");
  return '<button class="' + cls + '" data-game="' + gameId + '" data-cat="' + cat + '" data-val="' + value + '" ' + (locked?"disabled":"") + '>' + label + '</button>';
}
function rowSide(g, cat, label, awayKey, homeKey, awayLine, homeLine, picked, locked){
  return '<div class="pick-row">' +
    '<div class="pick-label">' + label + '</div>' +
    '<div class="pick-pair">' +
      pickBtn(g.id, cat, "away", awayKey + " " + fmtLine(awayLine), picked==="away", locked) +
      pickBtn(g.id, cat, "home", homeKey + " " + fmtLine(homeLine), picked==="home", locked) +
    '</div>' +
  '</div>';
}
function rowOU(g, cat, label, line, picked, locked){
  return '<div class="pick-row">' +
    '<div class="pick-label">' + label + '</div>' +
    '<div class="pick-pair">' +
      pickBtn(g.id, cat, "under", "Under " + fmtNum(line), picked==="under", locked) +
      pickBtn(g.id, cat, "over", "Over " + fmtNum(line), picked==="over", locked) +
    '</div>' +
  '</div>';
}

/* ===================== SUPER DOG / MORTAL TAB ===================== */
function renderExtraPicks(games, player){
  var entry = getEntry(STATE, player.id);
  var sd = entry.superDog || null;
  var mo = entry.mortal || null;
  var sdOpts = superDogOptions(games);

  var sdHtml = sdOpts.map(function(o){
    var locked = isLocked(o.kickoff);
    var selected = !!(sd && sd.gameId === o.gameId && sd.side === o.side);
    var cls = "extra-btn" + (selected ? " selected" : "") + (locked && !selected ? " locked" : "");
    var teamName = (TEAMS[o.team] || {name:o.team}).name;
    var oppName = (TEAMS[o.opp] || {name:o.opp}).name;
    return '<button class="' + cls + '" data-kind="superDog" data-game="' + o.gameId + '" data-side="' + o.side + '" ' + (locked && !selected ? "disabled" : "") + '>' +
      '<span class="extra-team">' + escapeHtml(teamName) + ' ' + fmtLine(o.line) + '</span>' +
      '<span class="extra-opp">vs ' + escapeHtml(oppName) + '</span>' +
    '</button>';
  }).join("");

  var moHtml = games.map(function(g){
    var locked = isLocked(g.kickoff);
    var m = mortalOptionsForGame(g);
    var spreadBtns = "";
    if (m.favAdjLine !== null){
      spreadBtns = moBtn(g.id, "spread", m.favSide, (TEAMS[m.favTeam]||{name:m.favTeam}).name + " " + fmtLine(m.favAdjLine), mo, locked) +
                   moBtn(g.id, "spread", m.dogSide, (TEAMS[m.dogTeam]||{name:m.dogTeam}).name + " " + fmtLine(m.dogAdjLine), mo, locked);
    }
    var totalBtns = moBtn(g.id, "total", "over", "Over " + fmtNum(m.overAdjLine), mo, locked) +
                     moBtn(g.id, "total", "under", "Under " + fmtNum(m.underAdjLine), mo, locked);
    return '<div class="mortal-game">' +
      '<div class="mortal-vs">' + escapeHtml((TEAMS[g.away]||{name:g.away}).name) + ' at ' + escapeHtml((TEAMS[g.home]||{name:g.home}).name) + '</div>' +
      '<div class="mortal-row">' + spreadBtns + '</div>' +
      '<div class="mortal-row">' + totalBtns + '</div>' +
    '</div>';
  }).join("");

  return '' +
  '<div class="extra">' +
    '<section class="extra-section">' +
      '<h2>Super Dog</h2>' +
      '<p class="extra-help">Pick one team getting +4.5 or more. Cover = 5 pts, outright win = 5 pts + the spread, push = 1 pt.</p>' +
      '<div class="extra-list">' + (sdHtml || '<div class="empty">No eligible underdogs this week.</div>') + '</div>' +
    '</section>' +
    '<section class="extra-section">' +
      '<h2>Mortal</h2>' +
      '<p class="extra-help">Buy 6 points toward whichever side you like on any spread or total. Correct = 1 pt, push = 0.5 pt.</p>' +
      moHtml +
    '</section>' +
  '</div>';
}
function moBtn(gameId, type, side, label, mo, locked){
  var selected = !!(mo && mo.gameId === gameId && mo.type === type && mo.side === side);
  var cls = "extra-btn small" + (selected ? " selected" : "") + (locked && !selected ? " locked" : "");
  return '<button class="' + cls + '" data-kind="mortal" data-game="' + gameId + '" data-type="' + type + '" data-side="' + side + '" ' + (locked && !selected ? "disabled" : "") + '>' + escapeHtml(label) + '</button>';
}

function renderLeaderboard(){
  return boardScope === "season" ? renderSeasonBoard() : renderWeekBoard();
}

function boardToggle(){
  return '<div class="scope-toggle">' +
    '<button type="button" class="scope-btn ' + (boardScope==="week"?"active":"") + '" data-scope="week">This Week</button>' +
    '<button type="button" class="scope-btn ' + (boardScope==="season"?"active":"") + '" data-scope="season">Season</button>' +
  '</div>';
}

function renderSeasonBoard(){
  var totals = seasonTotals();
  var played = allWeeks().filter(function(w){ return hasResults(w.results); }).length;
  var rows = totals.map(function(t, i){
    return '<button type="button" class="board-row" data-player-id="' + escapeHtml(t.id) + '">' +
      '<span class="board-rank">' + (i+1) + '</span>' +
      '<span class="board-name">' + escapeHtml(t.name) + '</span>' +
      '<span class="board-picks">' + fmtPts(t.total) + '</span>' +
      '<span class="board-chevron">\u203a</span>' +
    '</button>';
  }).join("");
  var breakdown = totals.map(function(t){
    return '<div class="board-mini">' +
      '<span class="n">' + escapeHtml(t.name) + '</span>' +
      '<span class="v">' + fmtPts(t.standard) + ' picks \u00b7 ' + fmtPts(t.superDog) + ' dog \u00b7 ' + fmtPts(t.mortal) + ' mortal</span>' +
    '</div>';
  }).join("");

  return '' +
  '<div class="board">' +
    boardToggle() +
    '<p class="board-note">Season standings across ' + played + ' graded week' + (played === 1 ? '' : 's') +
      '. Tap a name to see this week\u2019s card.</p>' +
    (rows || '<div class="empty">Nothing graded yet \u2014 standings appear once a week finishes.</div>') +
    (played ? '<div class="board-sub"><h3>Points by category</h3>' + breakdown + '</div>' : '') +
  '</div>';
}

function renderWeekBoard(){
  var entries = STATE.entries || {};
  var games = STATE.games || [];
  var results = STATE.results || null;
  var graded = hasResults(results);
  var byId = {};
  games.forEach(function(g){ byId[g.id] = g; });

  var list = Object.keys(entries).map(function(id){
    var e = entries[id];
    return {
      id: id,
      name: e.name || "Anonymous",
      made: scoreOf(e),
      card: graded ? gradeEntry(games, results, e) : null,
      superDog: e.superDog || null,
      mortal: e.mortal || null
    };
  }).filter(function(e){ return e.name; });

  if (graded) list.sort(function(a,b){ return b.card.total - a.card.total; });
  else list.sort(function(a,b){ return b.made - a.made; });

  var totalCats = games.length * CATEGORIES.length;
  var rows = list.map(function(e, i){
    var right = graded ? fmtPts(e.card.total) + ' pts' : e.made + ' / ' + totalCats;
    return '<button type="button" class="board-row" data-player-id="' + escapeHtml(e.id) + '">' +
      '<span class="board-rank">' + (i+1) + '</span>' +
      '<span class="board-name">' + escapeHtml(e.name) + '</span>' +
      '<span class="board-picks">' + right + '</span>' +
      '<span class="board-chevron">\u203a</span>' +
    '</button>';
  }).join("");

  function sdText(e){
    var g = byId[e.superDog.gameId];
    if (!g) return "\u2014";
    var lines = deriveLines(g);
    var teamKey = e.superDog.side === "home" ? g.home : g.away;
    var line = e.superDog.side === "home" ? lines.homeLine : lines.awayLine;
    var txt = escapeHtml((TEAMS[teamKey]||{name:teamKey}).name) + " " + fmtLine(line);
    if (e.card && e.card.superDogOutcome) txt += ' \u00b7 ' + fmtPts(e.card.superDog) + ' pts';
    return txt;
  }
  function moText(e){
    var g = byId[e.mortal.gameId];
    if (!g) return "\u2014";
    var m = mortalOptionsForGame(g);
    var txt;
    if (e.mortal.type === "spread"){
      var teamKey = e.mortal.side === m.favSide ? m.favTeam : m.dogTeam;
      var adjLine = e.mortal.side === m.favSide ? m.favAdjLine : m.dogAdjLine;
      txt = escapeHtml((TEAMS[teamKey]||{name:teamKey}).name) + " " + fmtLine(adjLine);
    } else {
      var adj = e.mortal.side === "over" ? m.overAdjLine : m.underAdjLine;
      txt = (e.mortal.side === "over" ? "Over " : "Under ") + fmtNum(adj);
    }
    if (e.card && e.card.mortalOutcome) txt += ' \u00b7 ' + fmtPts(e.card.mortal) + ' pts';
    return txt;
  }

  var sdRows = list.filter(function(e){ return e.superDog; }).map(function(e){
    return '<div class="board-mini"><span class="n">' + escapeHtml(e.name) + '</span><span class="v">' + sdText(e) + '</span></div>';
  }).join("");
  var moRows = list.filter(function(e){ return e.mortal; }).map(function(e){
    return '<div class="board-mini"><span class="n">' + escapeHtml(e.name) + '</span><span class="v">' + moText(e) + '</span></div>';
  }).join("");

  var note = graded
    ? 'Week ' + (STATE.week || 1) + ' final. 1 pt per correct pick, 0.5 on a push. Tap a name for the full card.'
    : 'Scoring is 1 point per correct pick, tallied once games finish. Until then this shows how many picks each player has locked in \u2014 tap a name to see them.';

  return '' +
  '<div class="board">' +
    boardToggle() +
    '<p class="board-note">' + note + '</p>' +
    (rows || '<div class="empty">No picks yet \u2014 be the first!</div>') +
    '<div class="board-sub">' +
      '<h3>Super Dog picks</h3>' +
      (sdRows || '<div class="empty">No Super Dog picks yet.</div>') +
    '</div>' +
    '<div class="board-sub">' +
      '<h3>Mortal picks</h3>' +
      (moRows || '<div class="empty">No Mortal picks yet.</div>') +
    '</div>' +
  '</div>';
}


/* ===================== EVENTS ===================== */
function wireShell(player){
  document.getElementById("name-chip").addEventListener("click", function(){
    var v = prompt("Update your name", player.name);
    if (v && v.trim()){
      savePlayerName(v.trim());
      var ns = cloneState(STATE);
      var entry = getEntry(ns, player.id);
      entry.name = v.trim();
      entry.updatedAt = new Date().toISOString();
      STATE.entries = ns.entries;
      renderApp();
      scheduleSave(ns);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function(btn){
    btn.addEventListener("click", function(){
      activeTab = btn.getAttribute("data-tab");
      renderApp();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".scope-btn"), function(btn){
    btn.addEventListener("click", function(){
      boardScope = btn.getAttribute("data-scope");
      renderApp();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".board-row"), function(row){
    row.addEventListener("click", function(){
      viewingPlayerId = row.getAttribute("data-player-id");
      renderApp();
    });
  });

  var pdBackdrop = document.getElementById("pd-backdrop");
  if (pdBackdrop){
    pdBackdrop.addEventListener("click", function(e){
      if (e.target === pdBackdrop){ viewingPlayerId = null; renderApp(); }
    });
  }
  var pdClose = document.getElementById("pd-close");
  if (pdClose) pdClose.addEventListener("click", function(){ viewingPlayerId = null; renderApp(); });

  var prev = document.getElementById("prev-btn"), next = document.getElementById("next-btn");
  if (prev) prev.addEventListener("click", function(){ currentIndex--; renderApp(); });
  if (next) next.addEventListener("click", function(){ currentIndex++; renderApp(); });

  var cardWrap = document.querySelector(".card-wrap");
  if (cardWrap){
    var startX = null;
    cardWrap.addEventListener("touchstart", function(e){ startX = e.touches[0].clientX; }, {passive:true});
    cardWrap.addEventListener("touchend", function(e){
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var games = STATE.games || [];
      if (dx < -40 && currentIndex < games.length - 1) { currentIndex++; renderApp(); }
      else if (dx > 40 && currentIndex > 0) { currentIndex--; renderApp(); }
      startX = null;
    }, {passive:true});
  }

  Array.prototype.forEach.call(document.querySelectorAll(".pick-btn"), function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      var gameId = btn.getAttribute("data-game");
      var cat = btn.getAttribute("data-cat");
      var val = btn.getAttribute("data-val");
      var ns = cloneState(STATE);
      var entry = getEntry(ns, player.id);
      if (!entry.picks[gameId]) entry.picks[gameId] = {};
      entry.picks[gameId][cat] = (entry.picks[gameId][cat] === val) ? null : val;
      entry.updatedAt = new Date().toISOString();
      entry.name = player.name;
      STATE.entries = ns.entries;
      renderApp();
      scheduleSave(ns);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".extra-btn"), function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      var kind = btn.getAttribute("data-kind");
      var gameId = btn.getAttribute("data-game");
      var side = btn.getAttribute("data-side");
      var ns = cloneState(STATE);
      var entry = getEntry(ns, player.id);
      entry.name = player.name;
      entry.updatedAt = new Date().toISOString();
      if (kind === "superDog"){
        var already = entry.superDog && entry.superDog.gameId === gameId && entry.superDog.side === side;
        entry.superDog = already ? null : {gameId: gameId, side: side};
      } else if (kind === "mortal"){
        var type = btn.getAttribute("data-type");
        var alreadyM = entry.mortal && entry.mortal.gameId === gameId && entry.mortal.type === type && entry.mortal.side === side;
        entry.mortal = alreadyM ? null : {gameId: gameId, type: type, side: side};
      }
      STATE.entries = ns.entries;
      renderApp();
      scheduleSave(ns);
    });
  });
}


/* ===================== INIT ===================== */

function fatal(msg){
  var root = document.getElementById("app");
  if (root) root.innerHTML =
    '<div class="boot error">' + escapeHtml(msg) + '</div>';
}

function boot(){
  loadSlate().then(function(slate){
    SLATE = slate;
    if (!SLATE || !SLATE.weeks || !SLATE.currentWeek) throw new Error("slate.json is malformed");
    return loadPicks(SLATE.season).catch(function(err){
      /* The slate loaded but the database didn't. Still let people pick —
         their card is kept locally and pushed as soon as the write lands. */
      console.error("could not load picks", err);
      return null;
    });
  }).then(function(rows){
    var dbDown = (rows === null);
    ALL_ROWS = rows || [];
    rebuildState();

    /* Put this device's own card back if the server hasn't got it yet. */
    var me = getPlayer();
    if (me.id && me.name){
      var mine = recallMyEntry(STATE.week);
      if (mine && entryIsNewer(mine, STATE.entries[me.id])){
        STATE.entries[me.id] = mine;
        scheduleSave({entries: STATE.entries});
      }
    }

    renderApp();
    if (!SB_READY) setStatus("setup");
    else if (dbDown) setStatus("offline");
    startPolling();

    /* Coming back to the tab should show other people's latest picks. */
    document.addEventListener("visibilitychange", function(){
      if (!document.hidden) refreshPicks();
    });
  }).catch(function(err){
    console.error(err);
    fatal("Couldn’t load this week’s games. " +
          "Check that slate.json is published next to index.html, then reload.");
  });
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();
