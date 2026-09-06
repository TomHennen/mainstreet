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

## Layout

```
engine/          Phaser 4 + TS. World-agnostic. The only code.
  schema.ts        world pack + episode types (DESIGN.md §3)
  validate.ts      declare-before-use flags, reachability, first-match rules
  loader.ts        fetches world data; probes assets by convention
  art.ts           engine-built placeholder tiles, buildings, characters
  scenes/          boot, map (villages and interiors), ui, travel
worlds/route10/  world.json, copy.json, episodes/, assets/ — data and PNGs only
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

## Status

Milestone M0 (see `DESIGN.md` §7). Tiled maps, Vitest, the validate scripts, CI,
the devcontainer and deployment all arrive in M1.
