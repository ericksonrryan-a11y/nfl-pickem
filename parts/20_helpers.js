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

