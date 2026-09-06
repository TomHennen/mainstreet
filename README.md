# mainstreet

An engine for small, cozy, episodic pixel-art town games. The engine knows
nothing about any particular town — all story, art and copy live in world packs
under `worlds/`. See `DESIGN.md` for architecture and `CLAUDE.md` for the rules.

First world: `worlds/route10/` — Jefferson, Stamford and Hobart, western
Catskills, NY.

## Run it

```sh
npm install
npm run dev
```

That is the whole workflow. `.env` selects which world pack the dev server
serves (`VITE_WORLD=route10`); the engine has no default and will refuse to boot
without it.

```sh
npx playwright install chromium   # once
npm run playtest
```

`npm run playtest` plays the current episode end to end in headless Chromium —
it walks the player between villages and interiors, talks to every character the
story needs, checks the flags each step is supposed to set, screenshots every
milestone, and exercises the touch d-pad and the A-button debounce on a phone
sized viewport. Screenshots and a run log land in `playtest-out/`, and it exits
non-zero with the milestone, the state and the screenshot path on the first
failure. It starts a dev server itself if one is not already on :5173.

```sh
npm test               # Vitest: engine logic only, plain Node, no jsdom
npm run validate-episodes   # every worlds/*/ pack, engine/validate.ts's rules
npm run validate-assets     # every worlds/*/ pack's PNGs and credits.json
```

`npm test` covers `engine/validate.ts` (every rule it enforces, plus the real
`worlds/route10/` pack), `engine/tiled.ts` (gid → tile, layer selection and
every way a map file can be malformed), `engine/session.ts` (flag-gated dialogue/sign/item
lookups), `engine/flags.ts`/`engine/bus.ts` (declare-before-use, the
`requires` AND, and effect application), and `scripts/png.ts` (the PNG
decoder/encoder, round-tripped against tiny generated fixtures). `npm run
validate-episodes` runs those same `engine/validate.ts` rules — nothing is
duplicated — against every world pack on disk and exits non-zero on the first
problem, with the world id, file and message. `npm run validate-assets` does
the same for every PNG under a world's `assets/` (building/char/portrait
sizes, tileset PNGs matching their JSON, every opaque pixel on-palette) and
for `credits.json` (every credited id must exist and be painted). Point
either script at a different worlds directory with an argument or
`MAINSTREET_WORLDS_DIR` (e.g. `node scripts/validate-assets.ts
path/to/worlds`).

## CI

Every pull request and push to `main` runs `.github/workflows/ci.yml`:
typecheck, `npm test`, `npm run validate-episodes`, `npm run validate-assets`,
a production build, then the headless playtest in a second job. When the playtest fails, its screenshots
and log are uploaded as the `playtest-out` artifact on the run. The
`.devcontainer/` gives the same environment (Node 22 plus Chromium) locally or
in Codespaces.

## Deploy

Every push to `main` builds every world pack and publishes them to GitHub
Pages, each at its own path, plus a small landing page at the site root that
links to them (`.github/workflows/pages.yml` runs `npm run build:site`). With
one world (`route10`) live, that's:

- `https://<owner>.github.io/mainstreet/` — the landing page
- `https://<owner>.github.io/mainstreet/route10/` — Route 10

One-time setup on a fresh repo: Settings → Pages → Source: "GitHub Actions".
Nothing else to configure; there are no secrets.

`scripts/build-site.mjs` does the work: it runs a separate `vite build` per
world under `worlds/` (each with `VITE_WORLD=<id>`, its own `--base` and its
own `dist/<id>/` output — a single Vite build only ever ships one world, see
`vite.config.ts`), then writes `dist/index.html` from each world's
`world.json` `title`/`subtitle`. `SITE_BASE` sets the path the whole site is
served under (default `/`; the Pages workflow passes
`/${{ github.event.repository.name }}`). To try it locally:

```sh
SITE_BASE=/mainstreet npm run build:site
npm run preview -- --outDir dist/route10 --base /mainstreet/route10/
```

Adding a world is content-only: drop a new `worlds/<id>/` pack (same shape as
`worlds/route10/`) and the next `build:site` picks it up automatically —
building it, and adding it to the landing page — with no engine or workflow
change.

## Layout

```
engine/          Phaser 4 + TS. World-agnostic. The only code.
  schema.ts        world pack + episode types (DESIGN.md §3)
  validate.ts      declare-before-use flags, reachability, first-match rules
  loader.ts        fetches world data; probes assets by convention
  tiled.ts         Tiled JSON + tileset parsing (DESIGN.md §2 conventions)
  art.ts           engine-built placeholder tiles, buildings, characters
  scenes/          boot, map (villages and interiors), ui, travel
worlds/route10/  world.json, copy.json, maps/ (Tiled JSON), episodes/, assets/,
                 palette.png, credits.json — data and PNGs only, no code
prototype/       route10-v3.html — behavioural reference, not code to reuse
```

Villages and interiors are the same kind of thing: a tile grid with exits. Giving
any building an interior later is a world-data change with no engine change.

## Adding art

Drop a PNG in at the conventional path and it replaces the placeholder on the
next reload. Nothing else to register.

| Path                                        | Size                                  |
| ------------------------------------------- | ------------------------------------- |
| `assets/buildings/<building-id>.png`         | footprint width × 16 wide; taller is fine — extra rows sit above the footprint |
| `assets/chars/<npc-id>.png`                  | 16×32 frames, 4 rows (down/left/right/up) × 3 |
| `assets/portraits/<npc-id>.png`              | 96×96 bust on transparency            |

A missing building PNG renders the labelled "unpainted" facade with its shimmer;
a missing portrait means text-only dialogue. Content always ships ahead of art.
Every PNG must draw only from the world's fixed palette at `palette.png`
(transparency is fine, partial alpha is not) — `npm run validate-assets`
checks this, and it runs in CI.

To credit a painted building, add it to `worlds/<id>/credits.json`:

```json
{ "buildings": { "stewarts": "Jordan R." } }
```

The value is who to credit, not a full sentence — copy.json's `ui.credit`
string ("Painted by {credit}.") supplies the wording. The file is optional
(no file = no credits) and can also carry `chars`, `portraits` and `tiles`
credits by id, keyed the same way. Once a building has both its PNG and a
credits.json entry, the credit shows as an extra line when the player
examines the building, after any sign text the episode gives it.
`validate-assets` rejects a credit for an id that doesn't exist, or one that
isn't painted yet.

## Status

Milestone M2 in progress (see `DESIGN.md` §7). Vitest, `validate-episodes`,
`validate-assets`, CI with the devcontainer and Tiled maps are in; art credits
are wired up but there is no painted art yet.
