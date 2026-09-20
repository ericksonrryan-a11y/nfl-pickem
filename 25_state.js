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

