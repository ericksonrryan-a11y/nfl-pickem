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

