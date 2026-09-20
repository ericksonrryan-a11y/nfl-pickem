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

/* Standings order. The board ranks on standard-pick win percentage; Mortal
   and Super Dog are reported alongside but do not move anyone up or down.

   A player with nothing graded has no percentage at all, so they sort to the
   bottom rather than being treated as 0%. Equal percentages break on the
   greater number of wins, so 30-10 finishes above 3-1, and points settle
   anything still level. */
function blankStanding(id, name){
  return {
    id: id, name: name || "Anonymous",
    standard: 0, superDog: 0, mortal: 0, total: 0, weeks: 0,
    picks: blankRecord(), mortalRec: blankRecord()
  };
}
function compareStandings(a, b){
  var pa = winPct(a.picks), pb = winPct(b.picks);
  if (pa === null && pb === null) return b.total - a.total;
  if (pa === null) return 1;
  if (pb === null) return -1;
  if (pb !== pa) return pb - pa;
  if (b.picks.w !== a.picks.w) return b.picks.w - a.picks.w;
  return b.total - a.total;
}

/* Cumulative season record and points per player across every completed week. */
function seasonTotals(){
  var totals = {};
  allWeeks().forEach(function(w){
    if (!hasResults(w.results)) return;
    for (var pid in w.entries){
      var e = w.entries[pid];
      var sc = gradeEntry(w.games, w.results, e);
      if (!totals[pid]) totals[pid] = blankStanding(pid, e.name);
      totals[pid].name = e.name || totals[pid].name;
      totals[pid].standard += sc.standard;
      totals[pid].superDog += sc.superDog;
      totals[pid].mortal += sc.mortal;
      totals[pid].total += sc.total;
      totals[pid].weeks++;
      addRecords(totals[pid].picks, sc.picksRecord);
      addRecords(totals[pid].mortalRec, sc.mortalRecord);
    }
  });
  /* Players who have joined but have no graded week yet still belong on the board. */
  for (var pid2 in (STATE.entries || {})){
    if (!totals[pid2]){
      totals[pid2] = blankStanding(pid2, (STATE.entries[pid2] || {}).name);
    }
  }
  return Object.keys(totals).map(function(k){ return totals[k]; })
    .sort(compareStandings);
}

