#!/usr/bin/env node
/**
 * Rebuild slate.json from ESPN's public NFL feed.
 *
 *   node scripts/build-slate.mjs --probe     inspect the feed, write nothing
 *   node scripts/build-slate.mjs             open a new week (grade + load games)
 *   node scripts/build-slate.mjs --grade     score the current week in place
 *   node scripts/build-slate.mjs --refresh   re-price games that have not kicked
 *   node scripts/build-slate.mjs --week 5    force a week instead of ESPN's
 *
 * What it does, in order:
 *   1. Fills in final (and where possible halftime) scores for the week the
 *      slate is currently on, so that week can be graded.
 *   2. Adds the new week's games — all of them — and points currentWeek at it.
 *
 * Only slate.json is touched. Picks live in Supabase and are keyed by week,
 * so nothing here disturbs them.
 *
 * No dependencies: Node 18+ native fetch only.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLATE = resolve(HERE, "..", "slate.json");

const API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
/* The NFL has no rankings and a small slate, so every game is included and
   there is nothing to filter on. These remain so the shared code below reads
   the same as the college build. */
const ALWAYS = [];              // no always-include team; every game qualifies
const UNRANKED = 99;
/* A game still not final this long after kickoff is cancelled or abandoned.
   Without this, one such game would block the rollover forever. */
const STALE_MS = 36 * 60 * 60 * 1000;

const argv = process.argv.slice(2);
const PROBE = argv.includes("--probe");
const REFRESH = argv.includes("--refresh");
const GRADE = argv.includes("--grade");
const forcedWeek = (() => {
  const i = argv.indexOf("--week");
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : null;
})();

const log = (...a) => console.log(...a);
const warn = (...a) => console.log("WARNING:", ...a);

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "nfl-pickem/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

const scoreboard = (params) =>
  getJSON(`${API}/scoreboard?limit=100&${params}`);

/* ---------------------------------------------------------------- probe --
   Reports the shape of the live feed rather than trusting documentation.
   Run this first; its output is the ground truth the rest is built on. */
async function probe() {
  log("=== PROBE: ESPN NFL feed ===\n");

  const sb = await scoreboard("");
  log("season:", JSON.stringify(sb.season));
  log("week:  ", JSON.stringify(sb.week));
  log("events:", sb.events?.length ?? 0);

  const byStatus = {};
  for (const e of sb.events ?? []) {
    const s = e.status?.type?.name ?? "?";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  log("status breakdown:", JSON.stringify(byStatus));

  const done = (sb.events ?? []).find((e) => e.status?.type?.completed);
  const any = done ?? (sb.events ?? [])[0];
  if (!any) return log("\nno events at all — cannot probe further");

  const comp = any.competitions?.[0] ?? {};
  log(`\n--- sample event ${any.id} (${done ? "COMPLETED" : "not completed"}) ---`);
  log("date:", comp.date);
  log("odds present:", Array.isArray(comp.odds) && comp.odds.length > 0);
  if (comp.odds?.[0]) {
    const o = comp.odds[0];
    log("  odds[0] keys:", Object.keys(o).join(", "));
    log("  spread:", o.spread, "| overUnder:", o.overUnder, "| details:", JSON.stringify(o.details));
    log("  homeTeamOdds.favorite:", o.homeTeamOdds?.favorite,
        "| awayTeamOdds.favorite:", o.awayTeamOdds?.favorite);
  }
  for (const c of comp.competitors ?? []) {
    log(`  ${c.homeAway}: ${c.team?.abbreviation} (${c.team?.displayName})`,
        "| rank:", c.curatedRank?.current,
        "| color:", c.team?.color,
        "| score:", c.score,
        "| linescores:", JSON.stringify(c.linescores ?? null));
  }

  if (done) {
    log("\n--- halftime sources for a completed game ---");
    const ls = comp.competitors?.[0]?.linescores;
    log("scoreboard linescores:", ls ? JSON.stringify(ls) : "ABSENT");
    try {
      const sum = await getJSON(`${API}/summary?event=${any.id}`);
      log("summary top-level keys:", Object.keys(sum).join(", "));
      const bs = sum.boxscore?.teams?.[0];
      log("boxscore.teams[0] keys:", bs ? Object.keys(bs).join(", ") : "none");
      const plays = sum.scoringPlays;
      log("scoringPlays present:", Array.isArray(plays), "count:", plays?.length ?? 0);
      if (plays?.[0]) {
        log("  scoringPlays[0] keys:", Object.keys(plays[0]).join(", "));
        log("  sample:", JSON.stringify({
          period: plays[0].period,
          awayScore: plays[0].awayScore,
          homeScore: plays[0].homeScore,
          team: plays[0].team?.abbreviation
        }));
      }
      const half = halftimeFromSummary(sum);
      log("derived halftime:", JSON.stringify(half));
    } catch (e) {
      warn("summary fetch failed:", e.message);
    }
  } else {
    log("\n(no completed game in this scoreboard — rerun the probe after games finish");
    log(" to verify halftime extraction)");
  }

  log("\n--- qualifying games this week ---");
  const games = (sb.events ?? []).map(toGame).filter(Boolean);
  log(`${games.length} of ${sb.events?.length ?? 0} events qualify`);
  const idx = new Map((sb.events ?? []).map((e) => [String(e.id), e]));
  await backfillOdds(games, idx);
  for (const g of games) {
    log(`  ${g.awayRank ? "#" + g.awayRank + " " : ""}${g.away} @ ` +
        `${g.homeRank ? "#" + g.homeRank + " " : ""}${g.home}` +
        `  spread ${g.spread} total ${g.total}` +
        (g.note ? `  [${g.note}]` : ""));
  }
  log("\n=== END PROBE ===");
}

/* ------------------------------------------------------------- helpers -- */

function rankOf(c) {
  const r = c?.curatedRank?.current;
  return typeof r === "number" && r > 0 && r < UNRANKED ? r : null;
}

/* Every NFL game is in. Kept as a function so swapping in a filter later —
   e.g. only division games, or only one team's games — is a one-line change. */
function qualifies(comp) {
  const cs = comp.competitors ?? [];
  if (!ALWAYS.length) return true;
  return cs.some((c) => ALWAYS.includes(c.team?.abbreviation));
}

/**
 * ESPN's `spread` is signed for the FAVOURITE, and `details` looks like
 * "MIA -20.5". The app wants the HOME team's line (negative = home favoured),
 * so resolve it from details when we can and fall back to the odds objects.
 */
function homeLine(comp, odds) {
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  const hAbbr = home?.team?.abbreviation;
  const aAbbr = away?.team?.abbreviation;

  const details = typeof odds?.details === "string" ? odds.details.trim() : "";
  const m = details.match(/^([A-Z0-9&.'-]+)\s+([+-]?\d+(?:\.\d+)?)$/i);
  if (m) {
    const [, who, numStr] = m;
    const num = Number(numStr);
    if (who.toUpperCase() === String(hAbbr).toUpperCase()) return num;
    if (who.toUpperCase() === String(aAbbr).toUpperCase()) return -num;
  }
  if (/^even|^pk/i.test(details)) return 0;

  if (odds?.homeTeamOdds?.favorite === true && typeof odds.spread === "number") {
    return -Math.abs(odds.spread);
  }
  if (odds?.awayTeamOdds?.favorite === true && typeof odds.spread === "number") {
    return Math.abs(odds.spread);
  }
  if (typeof odds?.spread === "number") return odds.spread;
  return null;
}

function toGame(event) {
  const comp = event.competitions?.[0];
  if (!comp || !qualifies(comp)) return null;

  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const odds = comp.odds?.[0];
  let spread = homeLine(comp, odds);
  let total = typeof odds?.overUnder === "number" ? odds.overUnder : null;

  /* Collect every warning: a game can be missing both, and the player needs
     to know each number that was invented rather than just the last one. */
  const notes = [];
  if (spread === null) { spread = 0; notes.push("line unavailable, treated as a pick'em"); }
  if (total === null) { total = 52.5; notes.push("total unavailable, estimated"); }
  const note = notes.length
    ? "Verify before kickoff — " + notes.join("; ")
    : null;

  const g = {
    id: String(event.id),
    away: away.team?.abbreviation ?? "AWAY",
    home: home.team?.abbreviation ?? "HOME",
    awayName: away.team?.shortDisplayName || away.team?.displayName || null,
    homeName: home.team?.shortDisplayName || home.team?.displayName || null,
    awayColor: away.team?.color ? "#" + String(away.team.color).replace(/^#/, "") : null,
    homeColor: home.team?.color ? "#" + String(home.team.color).replace(/^#/, "") : null,
    awayRank: rankOf(away),
    homeRank: rankOf(home),
    kickoff: new Date(comp.date ?? event.date).toISOString().replace(/\.\d{3}Z$/, "Z"),
    spread,
    total
  };
  const net = comp.broadcasts?.[0]?.names?.[0];
  if (net) g.network = net;
  if (note) g.note = note;
  return g;
}

/**
 * ESPN drops the `odds` block from the scoreboard once a game kicks off, so
 * any game already under way reads as having no line. The summary endpoint
 * keeps it (under `pickcenter` and/or `odds`), so fall back to that rather
 * than inventing a pick'em. Shapes vary between those two, so try each.
 */
async function oddsFromSummary(eventId) {
  let sum;
  try {
    sum = await getJSON(`${API}/summary?event=${eventId}`);
  } catch (e) {
    warn(`summary odds for ${eventId}: ${e.message}`);
    return null;
  }
  const candidates = []
    .concat(Array.isArray(sum.pickcenter) ? sum.pickcenter : [])
    .concat(Array.isArray(sum.odds) ? sum.odds : []);

  for (const o of candidates) {
    const hasSpread = typeof o?.spread === "number" || typeof o?.details === "string";
    const hasTotal = typeof o?.overUnder === "number";
    if (hasSpread || hasTotal) return o;
  }
  return null;
}

/** Fill in lines for games whose odds the scoreboard withheld. */
async function backfillOdds(games, eventsById) {
  const needy = games.filter((g) => g.note);
  if (!needy.length) return;
  log(`backfilling odds for ${needy.length} game(s) the scoreboard withheld`);

  for (const g of needy) {
    const ev = eventsById.get(String(g.id));
    const comp = ev?.competitions?.[0];
    const o = await oddsFromSummary(g.id);
    if (!o) { warn(`no odds anywhere for ${g.away} @ ${g.home}`); continue; }

    const fixed = [];
    if (comp) {
      const line = homeLine(comp, o);
      if (line !== null) { g.spread = line; fixed.push("spread"); }
    }
    if (typeof o.overUnder === "number") { g.total = o.overUnder; fixed.push("total"); }

    if (fixed.length) {
      log(`  ${g.away} @ ${g.home}: recovered ${fixed.join(" + ")} ` +
          `(spread ${g.spread}, total ${g.total})`);
    }
    /* Keep a warning only for whatever is still guessed. */
    const stillGuessed = [];
    if (!fixed.includes("spread")) stillGuessed.push("line unavailable, treated as a pick'em");
    if (!fixed.includes("total")) stillGuessed.push("total unavailable, estimated");
    g.note = stillGuessed.length ? "Verify before kickoff — " + stillGuessed.join("; ") : undefined;
    if (!g.note) delete g.note;
  }
}

/** Halftime points per side, from per-quarter linescores when the feed has them. */
function halftimeFromLinescores(comp) {
  const grab = (side) => {
    const c = comp.competitors?.find((x) => x.homeAway === side);
    const ls = c?.linescores;
    if (!Array.isArray(ls) || ls.length < 2) return null;
    const q1 = Number(ls[0]?.value ?? ls[0]);
    const q2 = Number(ls[1]?.value ?? ls[1]);
    if (Number.isNaN(q1) || Number.isNaN(q2)) return null;
    return q1 + q2;
  };
  const a = grab("away"), h = grab("home");
  return a === null || h === null ? null : { a1: a, h1: h };
}

/** Fallback: running score after the last scoring play of period 2. */
function halftimeFromSummary(sum) {
  const plays = sum?.scoringPlays;
  if (!Array.isArray(plays) || !plays.length) return null;
  let a = 0, h = 0, saw = false;
  for (const p of plays) {
    const period = p.period?.number ?? p.period;
    if (typeof period !== "number" || period > 2) continue;
    if (typeof p.awayScore === "number" && typeof p.homeScore === "number") {
      a = p.awayScore; h = p.homeScore; saw = true;
    }
  }
  // No first-half scoring at all still means 0-0, but only trust that when
  // the feed clearly had plays to look at.
  return saw || plays.length ? { a1: a, h1: h } : null;
}

async function resultsForWeek(weekNo, gameList) {
  const sb = await scoreboard(`week=${weekNo}&seasontype=2`);
  const byId = new Map((sb.events ?? []).map((e) => [String(e.id), e]));

  /* Fallback index by matchup. The first slate was written by hand with ids
     like "g1", which will never match an ESPN event id — without this, that
     week could never be graded. */
  const matchupKey = (a, h) => `${String(a).toUpperCase()}@${String(h).toUpperCase()}`;
  const byMatchup = new Map();
  for (const e of sb.events ?? []) {
    const c = e.competitions?.[0];
    const hm = c?.competitors?.find((x) => x.homeAway === "home")?.team?.abbreviation;
    const aw = c?.competitors?.find((x) => x.homeAway === "away")?.team?.abbreviation;
    if (hm && aw) {
      byMatchup.set(matchupKey(aw, hm), e);
      byMatchup.set(matchupKey(hm, aw), e);   // tolerate a flipped venue
    }
  }
  const out = {};
  let graded = 0, missingHalf = 0, unfinished = 0;

  for (const g of gameList) {
    const id = g.id;
    let e = byId.get(String(id));
    if (!e) {
      e = byMatchup.get(matchupKey(g.away, g.home));
      if (e) log(`  matched ${g.away} @ ${g.home} by teams (stored id "${id}" is not an ESPN id)`);
    }
    if (!e) { warn(`game ${id} (${g.away} @ ${g.home}) not found in week ${weekNo} feed`); continue; }
    const comp = e.competitions?.[0];
    if (!e.status?.type?.completed) {
      const kicked = Date.parse(g.kickoff);
      if (Number.isFinite(kicked) && Date.now() - kicked > STALE_MS) {
        warn(`${g.away} @ ${g.home} kicked off ${Math.round((Date.now()-kicked)/3.6e6)}h ago ` +
             `and still isn't final — treating it as abandoned and moving on`);
        continue;
      }
      unfinished++;
      continue;
    }

    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    const a = Number(away?.score), h = Number(home?.score);
    if (Number.isNaN(a) || Number.isNaN(h)) { warn(`game ${id} has no score`); continue; }

    const row = { a, h };
    let half = halftimeFromLinescores(comp);
    if (!half) {
      try {
        half = halftimeFromSummary(await getJSON(`${API}/summary?event=${id}`));
      } catch (err) { warn(`summary for ${id}: ${err.message}`); }
    }
    if (half) Object.assign(row, half); else missingHalf++;

    out[id] = row;
    graded++;
  }

  log(`week ${weekNo}: graded ${graded}, unfinished ${unfinished}, no halftime ${missingHalf}`);
  if (missingHalf) warn(`${missingHalf} game(s) without halftime — their 1H picks stay ungraded`);
  return { results: out, unfinished };
}


/* --------------------------------------------------------------- refresh --
   Saturday pass: re-price games in the CURRENT week that have not kicked off,
   without touching the week number, the game list, or any result.

   A line that moves after someone has picked it changes what their pick meant,
   so this refuses to move a line on a game anybody has already picked unless
   --force-reprice is passed. Picks live in Supabase, which the Actions runner
   can reach even though the slate lives here. */
async function pickedGameIds(season, week) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    warn("SUPABASE_URL / SUPABASE_KEY not set — cannot tell which games have " +
         "picks, so no line will be moved. Set them, or pass --force-reprice.");
    return null;
  }
  const base = String(url).replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const endpoint = `${base}/rest/v1/picks?season=eq.${season}&week=eq.${week}&select=picks`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  let r = await fetch(endpoint, { headers });
  if (r.status === 401 || r.status === 403) {
    r = await fetch(endpoint, { headers: { apikey: key } });   // publishable-key form
  }
  if (!r.ok) { warn(`could not read picks (${r.status}) — no line will be moved`); return null; }

  const rows = await r.json();
  const ids = new Set();
  for (const row of rows) {
    for (const gid of Object.keys(row.picks ?? {})) {
      const cats = row.picks[gid] ?? {};
      if (Object.values(cats).some(Boolean)) ids.add(String(gid));
    }
  }
  return ids;
}

async function refresh() {
  const slate = JSON.parse(readFileSync(SLATE, "utf8"));
  const wk = String(slate.currentWeek);
  const cur = (slate.weeks ?? {})[wk];
  if (!cur?.games?.length) throw new Error(`week ${wk} has no games to refresh`);

  const sb = await scoreboard("");
  const byId = new Map((sb.events ?? []).map((e) => [String(e.id), e]));
  const force = argv.includes("--force-reprice");
  const picked = force ? new Set() : await pickedGameIds(slate.season, slate.currentWeek);
  const now = Date.now();

  let moved = 0, heldPicked = 0, heldStarted = 0;
  for (const g of cur.games) {
    if (Date.parse(g.kickoff) <= now) { heldStarted++; continue; }

    const ev = byId.get(String(g.id));
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    let o = comp.odds?.[0] ?? null;
    if (!o) o = await oddsFromSummary(g.id);
    if (!o) continue;

    const newSpread = homeLine(comp, o);
    const newTotal = typeof o.overUnder === "number" ? o.overUnder : null;
    const spreadMoves = newSpread !== null && newSpread !== g.spread;
    const totalMoves = newTotal !== null && newTotal !== g.total;
    if (!spreadMoves && !totalMoves) continue;

    /* picked === null means we could not check; treat that as "do not move". */
    const unknown = picked === null;
    const isPicked = unknown ? true : picked.has(String(g.id));
    if (isPicked && !force) {
      const why = unknown ? "picks could not be checked" : "already picked";
      log(`  holding ${g.away} @ ${g.home} at ${g.spread}/${g.total} — ${why} ` +
          `(feed now ${newSpread}/${newTotal})`);
      heldPicked++;
      continue;
    }

    log(`  ${g.away} @ ${g.home}: ${g.spread}/${g.total} -> ${newSpread ?? g.spread}/${newTotal ?? g.total}`);
    if (spreadMoves) g.spread = newSpread;
    if (totalMoves) g.total = newTotal;
    if (g.note) delete g.note;
    moved++;
  }

  log(`refresh: ${moved} re-priced, ${heldPicked} held (already picked), ` +
      `${heldStarted} skipped (already kicked off)`);
  if (!moved) return log("nothing to write");
  writeFileSync(SLATE, JSON.stringify(slate, null, 1) + "\n");
  log("wrote slate.json");
}


/* ----------------------------------------------------------------- grade --
   Score the CURRENT week in place, without rolling over to a new one. Run the
   morning after the games so the leaderboard shows points the next day rather
   than waiting for Wednesday. Safe to run repeatedly: results merge, and a
   game that has not finished is simply skipped until it has. */
async function gradeOnly() {
  const slate = JSON.parse(readFileSync(SLATE, "utf8"));
  const wk = slate.currentWeek;
  const cur = (slate.weeks ?? {})[String(wk)];
  if (!cur?.games?.length) throw new Error(`week ${wk} has no games to grade`);

  const { results } = await resultsForWeek(wk, cur.games);
  const before = Object.keys(cur.results ?? {}).length;
  cur.results = { ...(cur.results ?? {}), ...results };
  const after = Object.keys(cur.results).length;

  if (after === before) return log(`week ${wk}: nothing new to grade (${before} already scored)`);
  writeFileSync(SLATE, JSON.stringify(slate, null, 1) + "\n");
  log(`wrote slate.json — week ${wk} now has ${after}/${cur.games.length} games scored`);
}

/* ---------------------------------------------------------------- main -- */

async function main() {
  if (PROBE) return probe();
  if (GRADE) return gradeOnly();
  if (REFRESH) return refresh();

  if (!existsSync(SLATE)) throw new Error("slate.json not found next to scripts/");
  const slate = JSON.parse(readFileSync(SLATE, "utf8"));
  slate.weeks ||= {};

  const sb = await scoreboard("");
  const espnWeek = forcedWeek ?? sb.week?.number;
  const season = sb.season?.year ?? slate.season;
  if (!espnWeek) throw new Error("could not determine the current week from ESPN");

  log(`ESPN reports season ${season}, week ${espnWeek}`);
  log(`slate is currently on week ${slate.currentWeek}`);

  // 1. grade the week the slate is on, if it isn't the week we're moving to
  const prev = slate.weeks[String(slate.currentWeek)];
  if (prev && slate.currentWeek !== espnWeek) {
    const { results, unfinished } = await resultsForWeek(slate.currentWeek, prev.games ?? []);
    if (unfinished) {
      warn(`${unfinished} game(s) from week ${slate.currentWeek} are unfinished — ` +
           `leaving that week open and making no changes`);
      return;
    }
    prev.results = { ...(prev.results ?? {}), ...results };
  }

  // 2. bring in the new week
  const games = (sb.events ?? []).map(toGame).filter(Boolean)
    .sort((x, y) => x.kickoff.localeCompare(y.kickoff));

  if (!games.length) throw new Error("no qualifying games found — refusing to write an empty slate");

  await backfillOdds(games, new Map((sb.events ?? []).map((e) => [String(e.id), e])));
  log(`week ${espnWeek}: ${games.length} qualifying games`);

  const playing = new Set();
  for (const g of games) { playing.add(g.away); playing.add(g.home); }
  log(`${playing.size} of 32 clubs playing; ${(32 - playing.size)} on bye`);

  /* Picks are stored keyed by game id, so changing a stored week's ids
     silently blanks everyone's card: the leaderboard still counts their picks
     but every game looks unpicked. So whenever this week already has games,
     carry the existing id across to the matching matchup rather than adopting
     ESPN's. Ids only ever need to be unique and stable — never meaningful. */
  const existing = slate.weeks[String(espnWeek)] ?? {};
  const prevGames = existing.games ?? [];

  if (prevGames.length) {
    const key = (a, h) => `${String(a).toUpperCase()}@${String(h).toUpperCase()}`;
    const prevById = new Map();
    for (const g of prevGames) {
      prevById.set(key(g.away, g.home), g.id);
      prevById.set(key(g.home, g.away), g.id);   // tolerate a corrected venue
    }
    let kept = 0;
    for (const g of games) {
      const old = prevById.get(key(g.away, g.home));
      if (old && String(old) !== String(g.id)) { g.id = String(old); kept++; }
    }
    if (kept) log(`kept ${kept} existing game id(s) so already-saved picks still resolve`);

    const dupes = games.length - new Set(games.map((g) => String(g.id))).size;
    if (dupes) {
      throw new Error(
        `re-keying produced ${dupes} duplicate game id(s) for week ${espnWeek}. ` +
        `Refusing to write a slate where picks could attach to the wrong game.`
      );
    }
  }

  slate.weeks[String(espnWeek)] = { games, results: existing.results ?? null };
  slate.season = season;
  slate.currentWeek = espnWeek;

  writeFileSync(SLATE, JSON.stringify(slate, null, 1) + "\n");
  log(`wrote slate.json — season ${season}, current week ${espnWeek}, ` +
      `${Object.keys(slate.weeks).length} week(s) stored`);
}

/* Exported so the logic can be unit-tested without touching the network. */
export { rankOf, qualifies, homeLine, toGame, halftimeFromLinescores, halftimeFromSummary };

/* Only run when invoked directly, not when imported by a test. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
