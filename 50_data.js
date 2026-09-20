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

