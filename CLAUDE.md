# CLAUDE.md — mainstreet

## What this project is

`mainstreet` is a generic engine for small, cozy, episodic pixel-art town games
played in the browser. Sessions are ~20 minutes: walk around, talk to people,
read things, follow one small story per weekly episode. It is explicitly NOT a
farming/crafting/stats game. No inventory grind, no combat, no timers.

The engine must know nothing about any specific town. All story, characters,
buildings, maps, art, and copy live in **world packs** under `worlds/`. The
first world is `worlds/route10/` — three real villages in the western Catskills
of New York (Jefferson, Stamford, Hobart) connected by NY Route 10.

Read `DESIGN.md` before doing anything. It is the source of truth for
architecture, the episode schema, the asset spec, and the roadmap. A working
single-file prototype lives at `prototype/route10-v3.html`; it is a *reference
for feel and behavior*, not code to reuse.

## Stack (decided — don't relitigate without asking)

- Phaser 4 + TypeScript + Vite. Static output, no backend.
- Maps authored in Tiled, exported JSON.
- Saves in localStorage, namespaced per world (and, off the release, per
  build channel: dev and each PR preview keep their own).
- Deploy: GitHub Pages via `.github/workflows/pages.yml`. `main` goes to
  `/mainstreet/dev/` on every push; the highest `v*` tag goes to the root;
  every open PR gets a playable preview at `/mainstreet/pr/<n>/`, linked
  from a comment on the PR.
  `npm run build:site` builds each world at its own path
  (`/mainstreet/route10/`) with a landing page at the root. Cloudflare Pages
  is deferred until there is a reason for it.
- Keep dependencies minimal. Every new dependency needs a one-line
  justification in the PR description.

## Hard rules

1. **Engine/content separation is inviolable.** If a change makes the engine
   import, reference, or special-case anything from a specific world, it is
   wrong. World packs are data + assets only: JSON and PNG, no code.
2. **Episodes are pure data.** Dialogue conditions and effects are declarative
   JSON (see schema in DESIGN.md) — never JS functions. If the schema can't
   express something an episode needs, extend the schema deliberately and
   document it.
3. **Assets load by convention with graceful fallback.** A missing building
   PNG renders the built-in labeled placeholder ("unpainted" look). A missing
   portrait means text-only dialogue. Content must always be shippable ahead
   of art.
4. **Mobile first.** Tap or click where you want to go is the primary control
   scheme — tap a person, a door, a sign or a plaque and the player walks over
   and reads it — with the touch d-pad + A button kept alongside it; keyboard
   (arrows/WASD, space/enter) is secondary. One input path via
   pointer events only — never register both pointer and touch handlers for
   the same control (this caused a real double-fire bug in the prototype).
   Debounce action taps (~200ms). Ignore key repeat for the action key.
5. **No real-person content without opt-in.** Real businesses appear by name
   with affectionate, neutral-or-positive flavor only. Never generate
   storylines that disparage a real business or depict a real private person
   who hasn't opted in. Fictional characters (Earl, Hannah) are fine.
6. **All copy must be nice.** Every line of text a player can read (dialogue,
   signs, travel cards, toasts, UI, placeholder labels) is warm, kind and
   affectionate toward the towns, the businesses and the people in them. No
   snark, no sarcasm, no edge, no jokes at anyone's expense, and nothing that
   could be read as a knock on a real place — even a gentle one like an empty
   pastry case or a slow line. Humour is fine when everyone in the scene
   would smile at it. When in doubt, make it kinder. One exception, by
   Tom's call only: a line of affectionate ribbing is fine when it is how
   locals actually talk about a place (Tops's produce), and Tom has okayed
   the exact wording.
7. No analytics, no trackers, no accounts in v1.

## Working style

- Small PRs, one milestone step at a time (milestones in DESIGN.md §Roadmap).
- During M0: bias hard toward the shortest path to something Tom can run and
  judge. Skip CI, devcontainers, deploy, and test scaffolding until M1 —
  but don't take shortcuts that violate the hard rules above, since those
  are architecture, not polish.
- From M1 on: Vitest for engine logic (schema validation, flag evaluation,
  save/load; don't chase render-test coverage), `scripts/validate-assets`
  and `scripts/validate-episodes` in CI, development in the devcontainer.
  No secrets exist in this project; keep it that way.
- When behavior questions come up ("how should travel screens feel?"), check
  the prototype first, then DESIGN.md, then ask.
- The main agent session coordinates; subagents do the coding, reviews and
  critiques, with a model matched to the task. Keep small fixes and final
  verification (typecheck, tests, playtest) in the main session.
- Maps: intelligible first, accurate second. State routes are paved with a
  dashed centre line, side streets sandy, sidewalks concrete; straight roads
  with at most one deliberate bend; clean crossings; no jumble of filler
  buildings. Maps start minimal and grow episode by episode: keep sizes
  generous, reserve full-size empty lots, never shift the grid. Run a critic
  pass (rubric in `docs/route10-notes.md`) before merging map changes and put
  whole-map previews in `playtest-out/` so Tom can open them.
- Small changes go under a standing issue rather than opening a new one:
  #27 art submissions, #36 Studio and contributing, #37 map and content
  tweaks. Branch as `agent/<issue>/<short-name>`. Open a dedicated issue only
  for something that needs a decision, or a change that takes more than a
  day.
- Incoming art from contributors is handled by the runbook in
  `docs/receiving-art.md` (standing issue #27). Follow it step by step.
- No model-generated art goes under `worlds/` — see CONTRIBUTING.md
  "Where AI fits". Computer-made examples are fine elsewhere (e.g. in docs)
  only when clearly labelled as computer-made.
- Local knowledge about the real villages lives in `docs/route10-notes.md`.
  Check it before placing anything; OpenStreetMap is a fallback, Tom's notes
  win.
- Agents merge their own PRs once CI is green (typecheck, tests,
  validate-episodes, build, headless playtest) and the diff has been reviewed
  against the hard rules. Tom reviews after the fact. Anything that changes
  player-facing copy, a real business, or DESIGN.md decisions still gets a
  heads-up in the PR description.

## Current focus

M1 is done (tests, CI, Tiled maps, Pages deploy). Current work is map
readability and corrections from Tom's walk-throughs; M2 (save/load, title
screen, art pipeline, credits) is next. See DESIGN.md §Roadmap.