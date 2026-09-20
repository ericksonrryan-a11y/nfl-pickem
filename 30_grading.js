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

/* ---------- win / loss / tie records ----------
   A "tie" is a push. Win% uses the standard sports formula,
   (W + 0.5*T) / decided, which happens to equal this pool's own scoring:
   a push is worth half a win, exactly as it is worth half a point. */
function blankRecord(){ return {w:0, l:0, t:0}; }
function addOutcome(rec, outcome){
  if (outcome === WIN) rec.w++;
  else if (outcome === LOSS) rec.l++;
  else if (outcome === PUSH) rec.t++;
}
function addRecords(into, from){
  into.w += from.w; into.l += from.l; into.t += from.t;
}
function recordCount(rec){ return rec.w + rec.l + rec.t; }
function winPct(rec){
  var n = recordCount(rec);
  if (!n) return null;                       // nothing graded — not 0%, unknown
  return (rec.w + 0.5 * rec.t) / n;
}
function fmtRecord(rec){ return rec.w + "-" + rec.l + "-" + rec.t; }
function fmtPct(p){
  if (p === null || p === undefined) return "—";
  return (p * 100).toFixed(1) + "%";
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
  var picksRecord = blankRecord();
  (games || []).forEach(function(g){
    var r = results && results[g.id];
    if (!r) return;
    var picks = (entry.picks && entry.picks[g.id]) || {};
    var res = gradeGamePicks(g, r, picks);
    detail[g.id] = res;
    for (var k in res){
      /* null means the category was left unpicked — it is not a loss. */
      if (res[k]){ standard += catPoints(res[k]); graded++; addOutcome(picksRecord, res[k]); }
    }
  });
  var sd = gradeSuperDog(entry.superDog, gamesById, results);
  var mo = gradeMortal(entry.mortal, gamesById, results);

  /* Mortal is one pick a week, so its record is 0-0-0 or a single mark.
     It is kept apart from the standard picks on purpose. */
  var mortalRecord = blankRecord();
  if (mo) addOutcome(mortalRecord, mo.outcome);

  return {
    detail: detail,
    standard: standard,
    picksRecord: picksRecord,
    mortalRecord: mortalRecord,
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

