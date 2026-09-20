/* ============================================================
   NFL Pick'em
   Static page + Supabase. No login: each device identifies itself
   with a random id kept in localStorage.

   Data lives in two places:
     slate.json  — games, lines and final scores, committed weekly
     Supabase    — everyone's picks, one row per player per week

   Note: the localStorage keys below are still cfbpickem_* — they are
   deliberately left alone, since renaming them would orphan the player id
   already stored on anyone's device.
   ============================================================ */
(function(){
"use strict";

var CFG = window.CFB_CONFIG || {};
var POLL_MS = CFG.POLL_MS || 20000;

/* STATE keeps the exact shape the render and grading code expects:
     {season, week, games, entries, results, history:[{week,games,results,entries}]}
   so that logic carries over unchanged from the earlier build. */
var STATE = {season: 2026, week: 1, games: [], entries: {}, results: null, history: []};

/* Raw slate.json, and every pick row for the season. */
var SLATE = null;
var ALL_ROWS = [];
