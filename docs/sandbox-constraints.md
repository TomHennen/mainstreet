# Sandbox constraints

What the rein sandbox lets an agent session do in this repo. Updated 2026-09-06.

## Works

- **npm registry.** `npm install`, `npm view`, `tsc`, `vite build`, `vite dev`.
- **Headless Chromium.** The host supplies Playwright's Chromium read-only
  under `~/.cache/ms-playwright`; never run `npx playwright install` (it
  hangs, then fails on the read-only dir). `npm run playtest` plays the game
  headless under WebGL with `--use-angle=swiftshader`.
- **Web access.** With `rein session open-egress` (Tom runs it, then
  restarts) the run can reach the public internet: Overpass, USGS NAIP
  aerial imagery and USGS topo services, PyPI. Without it only package
  registries and GitHub are reachable.
- **Python.** Python 3 without pip, PIL or numpy. pip can be bootstrapped as
  a zipapp from a PyPI wheel; `pip install --user --break-system-packages
  pillow` then works for the run.
- `git` and `gh` reads. Writes unlock after
  `rein declare <n> --repo TomHennen/mainstreet` is approved on Tom's
  terminal (once per run; a restart clears it; several issues can be
  declared in one run); pushes then go to `agent/<n>/<nonce>` only. The
  proxy token can push, open and merge PRs and create issues, but gets 403
  on Actions, Pages settings, rulesets and branch protection; `gh pr checks`
  and the commits check-runs API do work for watching CI. `gh pr edit` fails
  on a Projects-classic GraphQL error; use
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> --input body.json`.

## Still blocked

- Every host not on the allowlist: Phaser docs, Tiled downloads, the
  Resurrect 64 palette PNG. Ask for `rein session allow-domain <host>`;
  it applies on the next run.

## Filesystem

- Only the working tree at `/mnt/dev/dev/mainstreet` survives a run.
- `$HOME` writes succeed and are discarded at the end of the run; the
  scratchpad path changes every run. `node_modules` and anything under
  `playtest-out/` (gitignored) live in the working tree and persist, which
  is where map previews, reference imagery and the map generator are kept.

## Parallel agents share ports

Fixed: `npm run playtest` now always starts its own Vite rather than
attaching to whatever is already listening — it picks the first free TCP
port from 5173 up (or `PLAYTEST_PORT`, if set) and starts Vite there with
`--strictPort`, so two agents in separate worktrees each get their own
server. Set `PLAYTEST_URL` only to opt all the way in to testing an existing
server this script did not start (nothing is probed or started in that
case) — confirm by hand that it belongs to the tree you mean to test before
trusting a pass or a failure against it.
