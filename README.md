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

The game opens on the title screen: the world's name, the episodes it ships
(with a done mark on the finished ones), and a "write to us" link. Picking one
plays it, or carries on where you left off — progress lives in `localStorage`
under `mainstreet.<worldId>` and nothing leaves the browser. Add
`?episode=<id>` to the URL to skip the title and play any episode file under
`worlds/<id>/episodes/` for review, listed in `world.json` or not (a shelved
draft, or a fixture like route10's `ep000`) — e.g.
`http://localhost:5173/?episode=ep000`. A review run starts from the beginning
and writes no save. See DESIGN.md §2 and §3.

```sh
npx playwright install chromium   # once
npm run playtest
```

`npm run playtest` plays the current episode end to end in headless Chromium —
it walks the player between villages and interiors, talks to every character the
story needs, checks the flags each step is supposed to set, screenshots every
milestone, and exercises tap-to-walk, the touch d-pad and the A-button debounce
on a phone sized viewport. Screenshots and a run log land in `playtest-out/`, and it exits
non-zero with the milestone, the state and the screenshot path on the first
failure. It starts a dev server itself if one is not already on :5173.

```sh
npm test               # Vitest: engine logic only, plain Node, no jsdom
npm run validate-episodes   # every worlds/*/ pack, engine/validate.ts's rules
npm run validate-assets     # every worlds/*/ pack's PNGs and credits.json
npm run make-room      # a first-cut interior from a room spec (DESIGN.md §2)
```

`npm run make-room -- <world> <map id> --spec <file.json>` writes
`worlds/<world>/maps/<map id>.json` from a short spec — room size, the wall the
door is in, and the counters, shelves, tables, bar, stage, mats and planters in
it — and prints the `maps.<map id>` stanza to paste into `world.json`. The
specs route10's own interiors were built from are in `worlds/route10/rooms/`;
re-running one is a no-op, so an edit shows up as a real diff. It only places
tiles the world's tileset already has, and refuses a room you could not play
(furniture in the doorway, floor walled off from the door, a counter somebody
could walk round the back of). Rooms are ordinary Tiled maps afterwards.

`npm test` covers `engine/validate.ts` (every rule it enforces, plus the real
`worlds/route10/` pack), `engine/save.ts` (the save shape, and every way a
stored save can be unreadable), `engine/tiled.ts` (gid → tile, layer selection and
every way a map file can be malformed), `engine/session.ts` (flag-gated dialogue/sign/item
lookups), `engine/flags.ts`/`engine/bus.ts` (declare-before-use, the
`requires` AND, and effect application), and `scripts/png.ts` (the PNG
decoder/encoder, round-tripped against tiny generated fixtures). `npm run
validate-episodes` runs those same `engine/validate.ts` rules — nothing is
duplicated — against every world pack on disk and exits non-zero on the first
problem, with the world id, file and message. By default it checks only each
world's shipped episode list; `npm run validate-episodes -- --all` also
validates every other `episodes/*.json` on disk (review fixtures loaded via
`?episode=`), except files starting with `draft-`. `npm run validate-assets` does
the same for every PNG under a world's `assets/` (building/char/portrait
sizes, tileset PNGs matching their JSON, every opaque pixel on-palette) and
for `credits.json` (every credited id must exist and be painted). Point
either script at a different worlds directory with an argument or
`MAINSTREET_WORLDS_DIR` (e.g. `node scripts/validate-assets.ts
path/to/worlds`).

## CI

Every pull request and push to `main` runs `.github/workflows/ci.yml`:
typecheck, `npm test`, `npm run validate-episodes -- --all` (so review
fixtures like route10's `ep000` stay valid even though they're not shipped),
`npm run validate-assets`, a production build, then the headless playtest in
a second job. When the playtest fails, its screenshots
and log are uploaded as the `playtest-out` artifact on the run. The
`.devcontainer/` gives the same environment (Node 22 plus Chromium) locally or
in Codespaces.

## Deploy

The site on GitHub Pages carries two builds side by side, and
`.github/workflows/pages.yml` publishes both on every push to `main`, every
pushed `v*` tag, and on demand:

- the **release** at the site root — the highest `v*` tag (`v1.2.0`; a tag
  with a suffix like `v1.2.0-rc1` is left out), so a late tag for an older
  version never rolls the site back. Until the first tag exists, `main` is
  here too.
- the **dev build** at `/dev/` — whatever is on `main` right now.
- a **preview of every open pull request** at `/pr/<number>/`, built from
  the PR's head commit, so a change can be played before it is merged. The
  workflow posts the link as a comment on the PR and updates it on every
  push. Only PRs from branches in this repository get one (a fork's PR runs
  with a read-only token); a PR that fails to build is left out with a
  warning rather than holding up the site; and a closed PR is simply not in
  the next build, so its path goes away on its own (with the merge push, or
  with the next deploy of any kind if it was closed without merging).

Each build is every world pack at its own path plus a small landing page
that links to them (`npm run build:site`). With one world (`route10`) live:

- `https://<owner>.github.io/mainstreet/` — the release's landing page
- `https://<owner>.github.io/mainstreet/route10/` — Route 10, released
- `https://<owner>.github.io/mainstreet/dev/` — the dev build's landing page
- `https://<owner>.github.io/mainstreet/dev/route10/` — Route 10 from `main`
- `https://<owner>.github.io/mainstreet/pr/106/route10/` — Route 10 as PR #106 would have it

To release, tag `main` and push the tag (`git tag v1.0.0 && git push origin
v1.0.0`, or create a GitHub Release that makes the tag). The release is
built from its own checkout, so it ships with the build script it was tagged
with. Pages publishes one artifact as the whole site, so every build is
built fresh from git on every run (a push to `main`, a pushed tag, a PR
opened or updated, or a manual run) — nothing is kept between deploys.

Saves are one `localStorage` key per world (`mainstreet.<worldId>`), and
all the builds are on the same origin, so a save made in the dev build or a
PR preview is the same save the release reads. That is fine while the save format holds still;
a save-format change on `main` will meet a release build that treats it as
"no save yet".

One-time setup on a fresh repo: Settings → Pages → Source: "GitHub Actions",
and Settings → Environments → `github-pages` → Deployment branches and tags:
allow all branches (a pull request run deploys from `refs/pull/<n>/merge`,
which the default `main`-only policy refuses). Nothing else to configure;
there are no secrets.

`scripts/build-site.mjs` does the work: it runs a separate `vite build` per
world under `worlds/` (each with `VITE_WORLD=<id>`, its own `--base` and its
own `dist/<id>/` output — a single Vite build only ever ships one world, see
`vite.config.ts`), then writes `dist/index.html` from each world's
`world.json` `title`/`subtitle`. `SITE_BASE` sets the path the whole site is
served under (default `/`; the Pages workflow passes
`/${{ github.event.repository.name }}` for the release and
`/${{ github.event.repository.name }}/dev` for the dev build,
`/${{ github.event.repository.name }}/pr/<n>` for a PR preview). The dev
build and the previews are also passed `SITE_RELEASE_BASE`, which puts a
line at the foot of the landing page saying it is the in-progress build and
pointing at the release. The release never links to any of them. To try it
locally:

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
  save.ts          per-world localStorage saves (DESIGN.md §2)
  progress.ts      autosave, and putting a saved episode back
  scenes/          boot, title, map (villages and interiors), ui, travel
worlds/route10/  world.json, copy.json, maps/ (Tiled JSON), rooms/ (interior
                 specs), episodes/, assets/, palette.png, credits.json —
                 data and PNGs only, no code
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
| `assets/vehicles/<vehicle-id>.png`           | 32×32 frames, 4 rows (down/left/right/up), no walk frames |

The floating name plate keeps showing once a building is painted; set a
placement's `"label": false` in `world.json` if you want to hide it.

The engine also draws a small plaque at the foot of every facade, beside the
door — nobody paints it, and it is where the painter is thanked in the game
(and where an unpainted building asks for one). A placement's `"plaque"` moves
the walkable tile it is read from; the default is the tile right of the door,
and `"plaque": false` opts the building out.

A missing building PNG renders the labelled "unpainted" facade with its shimmer;
a missing portrait means text-only dialogue. Content always ships ahead of art.
Every PNG must draw only from the world's fixed palette at `palette.png`
(transparency is fine, partial alpha is not) — `npm run validate-assets`
checks this, and it runs in CI.

To credit a painted building, add it to `worlds/<id>/credits.json`:

```json
{ "buildings": { "stewarts": "Jordan R." } }
```

The value is who to credit, not a full sentence — copy.json's
`ui.plaque.painted` string supplies the wording. The file is optional
(no file = no credits) and can also carry `chars`, `portraits` and `tiles`
credits by id, keyed the same way. Once a building has both its PNG and a
credits.json entry, the painter is thanked on the small plaque beside that
building's door in the game, and named on the site's front page under that
world ("Painted so far"). It is deliberately not shown in the building's sign
dialogue: that box is for what the episode has to say about the place.
`validate-assets` rejects a credit for an id that doesn't exist, or one that
isn't painted yet.

## Receiving art

Contributors don't touch a repo — they paint in the in-browser Studio and press
"Send it to the town", which posts a text code of their drawing to the world
pack's own form (`submit.art` in `world.json`); the answers land in that form's
sheet, and a world pack without one falls back to an email with the code in the
body (see `CONTRIBUTING.md`). Save the code — from the sheet or from the email
— to a text file and run
`npm run decode-art -- path/to/submission.txt --credit "Their Name"`: it decodes
the code, checks it against the building's size, writes the PNG under
`worlds/<id>/assets/buildings/`, adds the credit to `credits.json`, and runs
`validate-assets` on the result. Then open a PR with the two changed files.

## Licences

- **Code** — everything outside `worlds/` — is Apache 2.0: see [`LICENSE`](LICENSE).
- **Art and world content** — everything under `worlds/`, and everything
  contributed to the project — is Creative Commons Attribution 4.0
  ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md), and a pointer to it at
  [`worlds/LICENSE.md`](worlds/LICENSE.md)). In short: anyone may copy, share
  and adapt it, commercially too, as long as they credit the creator.
- Contributors keep the copyright to what they make. The in-game plaque and the
  `credits.json` entry behind it *are* the attribution CC BY 4.0 asks for —
  there is nothing to sign.

## Status

Milestone M2 is done (see `DESIGN.md` §7): Vitest, `validate-episodes`,
`validate-assets`, CI with the devcontainer, Tiled maps, the asset conventions
and in-game art credits, save/load with episode completion, and the title
screen. M3 — the custom palette, commissioned facades and a couple more
episodes — is next.
