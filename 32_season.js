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

