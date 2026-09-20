# NFL Pick'em — handoff brief

Paste this whole file into a new Claude chat as your first message, along with
the zip. It carries the context so you don't have to re-explain anything.

---

## What this is

A working NFL pick'em, forked from a college-football version that is already
live and running. The code is complete and tested.

**Keep it entirely separate from the college app** — different Supabase
project, different repo, different URL. The two share a table shape, so
pointing both at one database would merge the pools under the same week
numbers.

## Architecture

| Piece | Where |
|---|---|
| Page | static HTML/CSS/JS on GitHub Pages |
| Picks | Supabase table `picks`, one row per player per week |
| Games, lines, scores | `slate.json`, committed by a GitHub Action |
| Weekly automation | `.github/workflows/slate.yml`, no token needed |

No logins. Each device stores a random player id in `localStorage`; the name
is a label on top of it. Entering a name that already exists offers to claim
that player, so one person on a phone and a laptop stays one entry.

Scoring happens **in the browser**, from raw scores in `slate.json`. The
Action only supplies final and halftime scores; it never computes points.

## Picks per game

Spread, Total, 1H Spread, 1H Total, and a team total for each side — six per
game. Plus two weekly specials:

- **Super Dog** — one team getting +4.5 or more. 5 pts for a cover, 5 + the
  spread for an outright win, 1 on a push.
- **Mortal** — buy 6 points onto any spread or total, either direction.
  1 pt correct, 0.5 on a push.

Standard picks are 1 pt correct, 0.5 on a push. 1H lines and team totals are
**derived** from the full-game spread and total (`deriveLines`), because books
don't publish them per game. Same number for everyone, but not real book lines.

## What changed from the college version

- ESPN endpoint is `/sports/football/nfl` instead of college-football
- No rankings, so **every** game is included (`qualifies()` returns true)
- `TEAMS` holds all 32 clubs
- Schedule shifted to the Thu→Mon NFL week

## Deployment status

The credentials are already filled in throughout this copy — `config.js`,
`.github/workflows/slate.yml` and `.github/workflows/keepalive.yml` all carry
the live project URL and publishable key. Nothing needs editing before upload.

What remains, if this has not been done yet:

1. **Supabase project + schema.** SQL editor, run the block under
   **Database schema** below.

2. **New public GitHub repo.** Upload the contents so `index.html` is at the
   root. **Drag files rather than pasting** — `app.js` is ~1400 lines and
   GitHub's web editor silently truncates large pastes.

3. **Settings → Pages** → Deploy from a branch → `main` → `/ (root)`.

4. **Actions → Update slate → Run workflow → mode `probe`**, then
   **`open-week`.** The shipped `slate.json` has no games in it; `open-week`
   fills in the current week.

## Database schema

```sql
create table picks (
  season      int  not null,
  week        int  not null,
  player_id   text not null,
  player_name text not null,
  picks       jsonb not null default '{}'::jsonb,
  super_dog   jsonb,
  mortal      jsonb,
  updated_at  timestamptz not null default now(),
  primary key (season, week, player_id)
);

-- Required on projects created after 2026-05-30. Supabase no longer exposes
-- new tables in the public schema to the Data API automatically, so without
-- these grants the table exists but /rest/v1/picks returns an error and the
-- page just says it isn't connected to a database.
grant select, insert, update on table public.picks to anon;
grant select, insert, update on table public.picks to authenticated;
grant select, insert, update on table public.picks to service_role;

-- A table made through the SQL editor does NOT get RLS automatically, so this
-- line matters: the grants above would otherwise leave it wide open.
alter table picks enable row level security;
create policy "read picks"   on picks for select using (true);
create policy "write picks"  on picks for insert with check (true);
create policy "update picks" on picks for update using (true) with check (true);
```

No `delete` grant — the app only reads and upserts, and the upsert needs
`insert` and `update` together because it posts with
`resolution=merge-duplicates`.

Keys live under **Settings → API Keys** in the dashboard; there is no longer a
separate Settings → API page. Use the **publishable** key
(`sb_publishable_…`) or a legacy **anon** key — the app and the keepalive
workflow both handle either. Never `service_role` or `sb_secret_…`.

## Hard-won gotchas — please don't rediscover these

- **Published Claude Artifacts cannot do this.** Their network is blocked and
  only signed-in editors can write. That is why this is a static site plus
  Supabase.
- **Never change a stored week's game ids.** Picks are keyed by game id.
  Changing them leaves the leaderboard counting picks correctly while every
  individual card renders blank — a genuinely confusing failure. The script
  already preserves existing ids when re-opening a week; keep that.
- **ESPN drops `odds` once a game kicks off.** The builder falls back to the
  summary endpoint. Don't remove `backfillOdds`.
- **`curatedRank.current` is 99 for unranked.** Irrelevant for the NFL but the
  constant is still there.
- **Cron is UTC and ignores daylight saving.** Every run shifts an hour earlier
  from 1 Nov. Grading is additive and Tuesday sweeps up, so nothing is lost.
- **Supabase pauses free projects after 1 week idle.** `keepalive.yml` pings
  every 3 days. Make sure it lands in `.github/workflows/`.
- **`.github` is hidden** in Finder and Explorer. On Mac press ⌘⇧. to reveal it
  before dragging, or create the files through GitHub's web editor by typing
  the full path with slashes.
- **Edit `parts/`, not `app.js`.** Run `python3 build_app.py` to rebuild.

## Known rough edges

- Anyone can claim any name. No logins means no way to prove identity. Fine for
  a private link; a PIN on first claim would tighten it.
- Any visitor can technically overwrite any row, for the same reason.
- The Sunday re-price run will not move a line on a game someone has already
  picked, since that would change what their pick meant. Override with
  `force_reprice` if you ever want it to.
- `styles.css` has a `prefers-color-scheme: light` block that re-declares the
  dark values, so light-mode devices still get the dark theme. That is
  deliberate; there is no light theme.

## Workflow modes

`Actions → Update slate → Run workflow`:

| Mode | Does |
|---|---|
| `probe` | Reads the ESPN feed and prints what it found. Writes nothing. |
| `open-week` | Grades the old week, loads the new one, bumps `currentWeek`. |
| `grade` | Scores the current week in place. Safe to repeat. |
| `refresh` | Re-prices games that haven't kicked off. |

Start with `probe` after any change to the builder.
