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

