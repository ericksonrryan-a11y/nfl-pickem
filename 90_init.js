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
