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
- Saves in localStorage, namespaced per world.
- Deploy: GitHub Pages via `.github/workflows/pages.yml` on every push to
  `main`. Cloudflare Pages (with each world at its own path, `/route10/`) is
  deferred until there is a reason for it.
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
4. **Mobile first.** Touch d-pad + A button is the primary control scheme;
   keyboard (arrows/WASD, space/enter) is secondary. One input path via
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
   would smile at it. When in doubt, make it kinder.
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
- Agents merge their own PRs once CI is green (typecheck, tests,
  validate-episodes, build, headless playtest) and the diff has been reviewed
  against the hard rules. Tom reviews after the fact. Anything that changes
  player-facing copy, a real business, or DESIGN.md decisions still gets a
  heads-up in the PR description.

## Current focus

Milestone M0: the smallest runnable build Tom can judge for feel.
See DESIGN.md §Roadmap for the definition of done.