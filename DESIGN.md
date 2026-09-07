# mainstreet — Design Document

_Engine for small, episodic, pixel-art town games. First world: **Route 10**._

## 1. Product shape

- Browser game, static hosting, playable in ~20 minutes per session.
- One new **episode** per week: a small story (find a thing, help someone,
  choose between neighbors, witness an event). No mechanical depth — the
  hooks are recognition (real places), continuity (NPCs remember flags from
  prior episodes), and voice (wry, specific, affectionate flavor text).
- Distribution model: a URL people revisit weekly, shared through local
  Facebook groups / word of mouth. Episodes can react to the real calendar
  (maple season, the fair, first snow).
- Community model: locals contribute story ideas and art over time. Tom is
  the editor; one editorial voice ships everything. Launch strategy is
  **real names + placeholder art**: buildings carry their real names from
  day one, art starts as engine placeholders and gets "filled in" by
  community contributions. Unpainted buildings are visible, claimable tasks
  ("adopt this building"), and every painter is named — on a small plaque
  beside that building's door in the game, and on the site's front page.

## 2. Architecture

```
mainstreet/
  engine/            # Phaser 4 + TS. World-agnostic. The only code.
  worlds/
    route10/
      world.json     # title, palette ref, building registry, map metadata, travel graph
      maps/          # Tiled JSON, one map per village + one per interior
      rooms/         # <interior>.json — the room spec each interior was built from
      episodes/      # ep000.json, ep001.json ... (pure data)
      assets/
        tiles/       # <tileset>.json (Tiled tileset) + <tileset>.png
        buildings/   # <building-id>.png facades (tile-multiple sizes)
        chars/       # <npc-id>.png sheets (16x32, 4 dir x 3 frames)
        portraits/   # <npc-id>.png 96x96 dialogue busts
      copy.json      # UI strings: title screen, travel-screen text per edge
  prototype/         # route10-v3.html — behavioral reference only
  scripts/           # validate-assets, validate-episodes, make-room
```

**Maps are Tiled JSON.** Every map id in `world.json` has a file at
`maps/<map id>.json`, fetched by that convention — the engine never follows a
path written in the data. What it expects of the file (all of it enforced in
`engine/tiled.ts`, with the error message an author would need):

- Orthogonal, finite, **16×16** tiles, layer data as a plain JSON array
  (Tiled's CSV export — base64/compressed is rejected).
- One visible tile layer named **`ground`**. Any further visible tile layers
  draw over it in file order and count for collision the same way; hidden
  layers are skipped and layer groups are descended into. Gid flip/rotation
  bits are masked off and ignored — the engine does not draw flipped tiles.
- **Tilesets are external**, one per world at
  `assets/tiles/<name>.json`, referenced with `"source"` (an embedded tileset
  works too, and is what a test fixture uses). Every tile a map uses must carry
  the properties below, or the map fails to load.
- **Object layers are ignored on purpose.** See below.

**A tile's properties.** The tile's Tiled *class* is its `kind` — grass, road,
water, wall, floor, counter, mat — which is there for the person editing the
map; the engine never branches on it. What the engine reads is Tiled custom
properties: `solid` (bool, default false — the only source of tile collision),
`style`, `colors` (comma-separated hex), optional `base` (a flat fill painted
under the recipe) and optional `edge` (the colour of a front face painted along
the bottom of the cell, for a surface raised above the ground plane — the near
row of a deck or a porch). `style` is one of seventeen drawing recipes (`flat`,
`speck`, `ripple`, `tree`, `flower`, `prop`, `disc`, `rim`, `umbrella`, `stele`,
`block`, `shelf`, `mat`, `planks`, `pavers`, `stripe-h`, `stripe-v`), so a tile is fully
self-describing and variants of a
kind — three grasses, road with and without a crack — are separate tiles the
author paints with, rather than something the engine randomises per position.

**Tileset art follows the same fallback rule as everything else.** The tileset
declares its `image`; if that PNG is there the engine blits tiles straight out
of it, and if it is not, the engine paints the `style`/`colors` recipes into a
runtime texture of exactly the declared sheet size and uses that instead. A
world therefore plays identically before and after an artist fills the sheet
in. (Tiled itself will ask for the missing PNG when opening an unpainted
tileset; painting the sheet is the fix, and it is on the M3 art list.)

**What stays in `world.json`, and why.** Everything a content author positions:
the building registry and its placements (footprint, door, interior + spawn),
map labels, exits and the travel graph, street fixtures, the villages' own
townspeople, the start position,
map names and whether a map is a village or an interior. Tiled *could* carry those as object
layers, but then a door would live in two files and a footprint would have two
sources of truth. One place to edit gameplay positions is worth more than
seeing them in the map editor, so Tiled carries the tile grid and nothing else,
and the engine ignores object layers entirely. `world.json`'s `maps` block is
per-map metadata; the grid is joined onto it at load.

**Scenes:** Boot → Title → Village (one per map) → Interior → Travel
interstitial (covers map swaps) → Dialogue UI overlaid on any scene.

**Controls.** Tapping (or clicking) the town is the primary way to play:
the player walks to the tapped tile along walkable ones — breadth-first over
the map's collision, people included, and never across a road out of the
village unless that road is what was tapped — and a small ring marks where
they are headed until they get there. A tap on a blocked or unreachable tile
walks to the nearest tile beside it, or, if there is no way through at all,
blinks the ring once and stays put. Tapping a person, a door, a shopfront, a
plaque, a street fixture or something lying about walks over and does the
thing on arrival, with no A press: a door with an interior behind it opens,
a door without one reads the sign, the plaque — the tile it is read from, or
the little brass one drawn on the wall above it — thanks whoever painted the
place, and anywhere else on a building's picture, roof and floating name
plate included, is its front, which walks to the doorstep and reads the sign
rather than walking in. What was tapped is what happens when the walk ends,
not whatever is in reach of where it ended; if the player is already standing
in the right place it happens straight away. Somebody behind a counter, with
no free tile beside them, is walked up to as close as that same reach
allows. Any d-pad or movement key
calls the walk off on the spot, and a new tap replaces the destination; A
waits until the walk is over rather than stranding the player half way.
The touch d-pad and A button stay exactly as they are, for anyone who
prefers them, and the keyboard (arrows/WASD, space/enter) sits behind both.
It is all one pointer path (`engine/input.ts`), and the routing is a pure
function over a walkability callback (`engine/path.ts`) so it can be tested
without a scene.

**Travel:** villages are separate Tiled maps joined by a travel graph in
`world.json` (edge = exit zone → destination map + spawn point). Crossing an
edge plays the interstitial: fade, rolling-road animation, per-edge copy from
`copy.json` ("a few miles later — welcome to STAMFORD"). Leaving Stamford
must show the real roadside sign (see §5 open items). Arrival cards use real
village nicknames (see §5).

**Interiors:** defined in world data (room map + counter/shelf collision +
NPC placement), entered via building doors, exited via a door mat. Any
building may gain an interior in a later episode with zero engine changes.
Interiors are not a special case for the camera: size a room to the real
place (a Stewart's is big, a coffee shop is a proper room), the camera
follows the player exactly as it does outdoors, and a room that happens to
fit the screen simply sits centred. Zoom is the same whole number inside and
out so the player stays the same size; the engine only steps zoom up when a
whole map fits at the larger step.

A first-cut room does not have to be drawn tile by tile. `scripts/make-room`
takes a short spec — size, which wall the door is in and where along it, the
wall and floor tiles, and a list of props placed by rectangle or by tile
(`counter`, `bar`, `shelf`, `table`, `stage`, `mat`, `planter`, `sign`) — and
writes the Tiled file plus the `maps.<id>` stanza to paste into `world.json`:

```sh
npm run make-room -- route10 stamford-coffee-interior \
  --spec worlds/route10/rooms/stamford-coffee-interior.json
```

The spec lives in the world pack at `rooms/<map id>.json` — data, like
everything else in a pack, and read by nothing at run time — so a room can be
regenerated after an edit and the diff is the change. The script only ever
places tile ids the world's own tileset already has, found by tile kind, and
it refuses a room that would not play: furniture in the wall or the doorway, a
spawn tile with something standing on it, floor walled off from the door, or a
counter whose staff strip is open to the room. That strip is the point of the
`counter`/`bar` props: the run of counter tiles gets a one-tile pocket behind
it, closed at the ends with short returns, so somebody serving from it stays
behind it (Stewart's register counter, drawn for you). Interiors are still
ordinary Tiled maps afterwards — an artist opens one in Tiled and refines it,
and the script is not the owner of the file.

**Saves:** localStorage, one key per world — `mainstreet.<worldId>` — holding a
versioned file:

```jsonc
{ "v": 1,
  "completed": ["ep000"],                      // episodes played to the end
  "episodes": {
    "ep001": { "flags": ["metEarl"], "taken": ["scout"],
               "map": "stamford", "pos": [19, 14], "facing": "up" } } }
```

Per episode: the flags that are true, the things picked up, and the tile the
player was standing on. Nothing else is ever stored — no names, no times, no
counts — and none of it leaves the browser (hard rule 7). The game writes on
every flag set, every item taken and every arrival on a new map, folding the
change into the file it already holds in memory and stringifying once
(`engine/save.ts`, `engine/progress.ts` `autosave`). Every read is defensive: a
save from another version, hand-edited JSON, or a browser that refuses storage
at all (private mode) reads as "no save yet" and the episode starts from the
beginning — losing a save is a small sadness, a blank screen is worse (hard
rule 3). An episode is complete when its `done` flag is set (§3); completing it
adds its id to `completed`, where it stays, so "play again" can clear that
episode's progress without forgetting it was played.

**The title screen** (`engine/scenes/title.ts`) is what a URL with no
parameters opens on: the world's name and subtitle, the episodes `world.json`
ships — number, title, and a done mark on the finished ones — and the world's
"write to us" link as the last item, wherever `world.json` has a `feedback`
block. The cursor waits on the first unfinished episode, and the highlighted
entry says what taking it would do: play it, carry on with it where there is a
save, or play it again where it is finished. All five words are `copy.json`'s
(`ui.title.play`, `.continue`, `.again`, `.done`, `.write`) — the engine draws
the list and knows none of the wording (hard rule 1), and a world that leaves
one out simply doesn't get that bit drawn (hard rule 3). Tapping an entry takes
it, the d-pad and the arrow keys move the cursor, A (space, enter) takes the
highlighted one, and the write link is a real DOM anchor, so touch, Tab and
Enter stay the browser's job. `?episode=<id>` skips the title and plays that
episode for review (§3).

**Fallback art (engine-built, not per-world):** unpainted building =
flat facade in a neutral wall color + roof band + door + the building's name
on a sign, plus a subtle "needs an artist" shimmer.

**The plaque beside the door.** Every building, painted or not, gets a small
brass plaque the engine draws at the foot of its facade — artists never paint
one, it simply sits on top of their art. It is read from a walkable front-row
tile, given by a placement's `plaque` in `world.json`: by default the tile
immediately right of the door, or immediately left when the door is already in
the building's right-most column; `"plaque": false` opts a building out. The
plaque is the one place in the game that talks about the art. Painted, it
thanks whoever painted it, by name from `credits.json` — one name, or several
joined in a list ("Tom, Lana and Alice") when more than one person worked on
it — (`copy.json` `ui.plaque.painted`, or `ui.plaque.anonymous` when no name
is on file), and offers **Improve it?**, which opens the Studio with that
painting already loaded onto the canvas (`ui.improve`, `engine/paint.ts`
`improveUrl`), for a touch-up rather than starting over. Unpainted, it
carries the invitation (`ui.plaque.unpainted`) alongside a "Paint it" link to
the contribution page (`world.json` `contribute` is that URL; the engine
appends `&building=<id>`), which sits beside the dialogue box for every page
of it rather than taking a line of copy. That leaves the building's *sign*
entirely to the story: no link, no credit, because meta text in the middle of
the words gets in the way of reading. If the episode gives an unpainted
building no sign copy at all, the box would open empty, so `copy.json`
`ui.unpainted` supplies one short line instead.

**Street fixtures, and the suggestion box.** A map may list engine-drawn
furniture that belongs to no building and no episode:

```jsonc
"maps": {
  "jefferson": {
    "fixtures": [{ "kind": "suggestion-box", "pos": [5, 12] }]
  }
}
```

`kind` is one of the shapes the engine knows how to draw (today: just
`suggestion-box`, a little post box in two colours). A fixture stands on its
own tile, is drawn at that tile's depth so the player passes behind it going
up the street, and is **solid** — the player walks up beside it and presses A
rather than standing on it, which is the one way it differs from the plaque.
The validator refuses a fixture that is off the map, on a solid tile, on a
door or plaque tile, or on the tile the player arrives at (the world start, or
an exit's spawn). Painted art for a fixture would arrive by the usual
convention (`assets/props/<kind>.png`); that is not wired up yet, and the drawn
shape is what ships until it is.

The suggestion box is how somebody with a story idea — or a correction — says
so, with no backend and no account anywhere in it (hard rule 7). Its lines are
`copy.json` `ui.suggest.lines`, and `ui.suggest.link` labels the DOM link that
sits beside the box for every page of the entry, exactly like "Paint it". The
link itself is composed from `world.json`'s top-level `feedback`:

```jsonc
"feedback": {
  "email": "tom.hennen+mainstreet@gmail.com",
  "subject": "A story idea for Route 10"
}
```

which becomes a `mailto:` whose body is `ui.suggest.body`, an array of lines
the world writes — brief labelled prompts the sender fills in or deletes. A
`feedback` with a `url` instead opens that page. No `feedback`, or no
`ui.suggest.link`, and the box simply reads with no link (hard rule 3). No
address, subject or wording appears anywhere in engine code.

**Townspeople who walk.** Nothing on a map moves but the player unless the
data says otherwise, and two shapes of data say otherwise. Both belong to a
person — an episode NPC (§3) or one of a village's own people, below — and
both are walked by `engine/mover.ts`, which is pure and knows nothing but
tiles:

```jsonc
"route":  { "path": [[75, 15], [42, 15]],   // waypoints, walked in order
            "loop": true,                    // default: back to the first
            "pause": 1.2,                    // seconds at each one, default 1.5
            "speed": 5.1 },                  // tiles/s, default walking x 0.8
"wander": { "radius": 3, "pause": 2 }        // or: potter about near home
```

A route places the corners of a stroll, not every step of it: the engine's own
pathfinder (`engine/path.ts`) fills in the way from one waypoint to the next,
and goes round anything in the way. A wander picks a tile within `radius` of
the person's `pos`, walks there, stands a moment and picks another; it stays
inside the radius the whole way round, and the choices are seeded from the
person's id so a village looks the same on every visit rather than jittering.

Where anybody but the player may put their feet is deliberately stricter than
the player's own collision: never a solid tile, a fixture, a doorstep or a
plaque tile — all of which are read by standing exactly there — and never a
road out of the village, which is the player's to take. `validate-episodes`
holds a route to the same rule, and to being walkable from waypoint to
waypoint, so a route that could never be walked fails at build time rather
than leaving somebody standing still for ever.

Somebody walking stays solid, and stops the moment the player is close enough
to talk to them, so nobody is ever chased down the street or walks off
mid-sentence; they turn to face whoever comes over, and carry on once the
player steps away. They never walk onto the player or onto each other, going
round where there is a way round and waiting where there is not. A tap lands
on where somebody *is*, not where the data placed them, and the walk follows
them if they carry on. None of it touches the save: where a townsperson got to
is not progress.

**A village's own people.** A map may carry a `people` list — townspeople who
belong to the village rather than to any one story, so a street is not empty
between episodes:

```jsonc
"maps": {
  "stamford": {
    "people": [
      { "id": "stamford-main-walker", "pos": [42, 15], "facing": "right",
        "look": { "hair": "long", "hairColor": "#4a3524", "shirt": "#7a8f5c" },
        "route": { "path": [[75, 15], [42, 15]], "pause": 1.2 } }
    ]
  }
}
```

They have a `look` (§4) and somewhere to be, and **no dialogue at all**:
pressing A on one gets a single kind line from `copy.json` `ui.passerby`,
picked from that list by their id, so the same person always says the same
thing and no line is written twice. The name on the box is `ui.passerbyName`
— "A neighbour" on Route 10 — unless the person carries a `name` of their
own, which is the exception rather than the rule: these are people the player
passes, not people they are introduced to. A world with no `ui.passerby`
simply has nothing for them to say, and they read as somebody minding their
own business; one with no `ui.passerbyName` shows a box with no name on it
(hard rule 3). Anybody with something to say is an episode NPC. Two or three
per map is what a street reads as; the validator refuses more than six.

Missing NPC sheet = generic townsperson sprite, drawn from that person's
`look` (§4) in their own accent color. Missing portrait = no portrait pane.
The floating name plate stays above a building once it's painted too,
positioned the same way relative to the footprint (or above the art's
top edge if the facade is taller than the footprint); a placement can set
`"label": false` in `world.json` to hide it.

## 3. Episode schema (v1)

Everything conditional is expressed with `requires` (all listed flags true)
and `effects` (applied when the node is shown/consumed). No code in content.

```jsonc
{
  "id": "ep000",
  "title": "The Crossword Pen",
  "flags": ["metEarl", "hasPen", "done"],          // declared, start false
  "npcs": [
    {
      "id": "earl",
      "name": "Earl",
      "map": "stamford",
      "pos": [34, 33],
      "wander": { "radius": 2 },                     // optional: see §2, "route" too
      "dialogue": [                                  // first matching entry wins
        { "requires": ["done"],   "lines": ["Seventeen across: 'small kindness, nine letters.' I'm going to say it's you, kid."] },
        { "requires": ["hasPen"], "lines": ["Ha — my pen! Knew I left it up at the pond.",
                                             "Tell Hannah your coffee's on me."],
          "effects": [{ "set": "done" }, { "toast": "Episode complete" }] },
        { "requires": ["metEarl"], "lines": ["Bench by the mill pond, up in Jefferson. That's my puzzle spot."] },
        { "requires": [],          "lines": ["'Morning. You're the new one, right?",
                                             "Lost my crossword pen up at the pond Wednesday.",
                                             "Forty years of Saturday puzzles. Would you look by the bench?"],
          "effects": [{ "set": "metEarl" }] }
      ]
    }
  ],
  "items": [
    { "id": "pen", "map": "jefferson", "pos": [9, 11],
      "requires": ["metEarl"], "effects": [{ "set": "hasPen" }],
      "lines": ["A fine ballpoint by the pond bench. This has to be Earl's."] }
  ],
  "signs": [                                         // flavor, may vary by flags
    { "building": "mill-pond-inn", "requires": [],   // read at the door, with a prompt
      "replace": false,                              // default: the standing sign reads after it
      "lines": ["Chalkboard: pizza night Monday and Wednesday. Underlined twice: RIBS SOLD OUT."] },
    { "map": "stewarts-interior", "pos": [11, 4], "requires": [],   // a prop: no prompt
      "lines": ["The ice cream case hums along beside the shelves."] }
  ]
}
```

A sign carries exactly one of `building` (read at that building's door, with
the A prompt) or `map` + `pos` (a prop such as a shelf or a counter, examined by
standing next to it, deliberately with no prompt).

A building may also carry a **standing sign** in `world.json`, on its entry in
the `buildings` registry — what is chalked up at its door on an ordinary day,
one array entry per page:

```jsonc
"solinskys": { "name": "Solinsky's", "wall": "#d8c3b0", "roof": "#8a5a4a",
               "sign": ["Brisket sandwiches Saturday, and they do sell out."] }
```

Episodes add to it: an episode sign for that building whose `requires` are met
reads first, and the standing sign follows on the next page — a flyer taped in
the window sits on top of the place without erasing it, so a week of story
never costs the player the colour of the places it sends them to. An episode
that wants the whole door for itself sets `"replace": true` on its sign, and
the standing sign steps aside for as long as that sign is the one showing. A
building with neither kind of sign falls back to `copy.ui.unpainted`, which is
now only ever seen at a door nobody has written anything for yet.

Every building a map actually places must carry a standing sign, and
`validate-episodes` enforces it: a door the player can walk up to reads copy
somebody wrote for that place, not the stand-in. A registry entry no map
places yet may go without one until it is put on a map.

An episode is **complete** when a flag called `done` is set — the one flag name
the engine knows, and a convention of the schema rather than of any world.
Setting it is what puts the episode on the save's `completed` list and its done
mark on the title screen (§2). An episode that never declares `done` simply
never completes.

An NPC may carry a `route` or a `wander` (§2, "Townspeople who walk") and move
about while the story waits. `pos` stays the tile they start on and the one an
author places them by; they are simply not always standing on it, and they
stop as soon as the player is close enough to talk to them.

Engine responsibilities: declare-before-use flag validation, first-match
dialogue resolution, effect application, sign lookup, item visibility.
`validate-episodes` enforces: unknown flags, unreachable dialogue entries,
missing maps/buildings/positions, effects on undeclared flags, a standing
sign on every building a map places, and routes and wanders that can actually
be walked.

A world's shipped episodes are `world.episodes`, in order; the title screen
lists exactly those, and puts the cursor on the first unfinished one. A `?episode=<id>` URL parameter plays any episode file under
`worlds/<id>/episodes/`, listed in `world.json` or not, for review — e.g. a
shelved draft, or a test fixture kept off the shipped list. The id must match
`[A-Za-z0-9_-]+`; an id that fails that pattern, has no matching file, or
fails validation falls back to the title screen with a console warning rather
than a blank screen (hard rule 3). A `?episode=` run is a review run: it starts
that episode from the beginning and writes no save at all, so looking over next
week's story never disturbs anybody's own progress through it. `npm run validate-episodes` only
checks the shipped list by default; `--all` also validates every other
`episodes/*.json` on disk except files starting with `draft-`.

Future (not v1): `"date"` conditions for calendar-reactive content;
`"choice"` nodes; cross-episode flag imports (global flags already cover
most continuity needs).

## 4. Asset spec (give this to artists verbatim)

- Pixel art. Grid: **16×16 px tiles**. PNG, transparency, **no anti-aliasing**.
- **One fixed palette** shipped as `worlds/<id>/palette.png` (Route 10 starts
  with Resurrect 64 until a custom Catskills palette is commissioned).
  `validate-assets` rejects off-palette pixels.
- Tilesets: sheets on the 16px grid. One per world at
  `assets/tiles/<name>.png`, laid out exactly as its `assets/tiles/<name>.json`
  says (`columns`, `tilecount`, `margin`, `spacing`), tile id 0 top-left.
- Building facades: one PNG per building, dimensions in tile multiples
  (e.g. 96×64). Filename = building id from `world.json`. **Width = the
  footprint width in tiles × 16.** Height may exceed the footprint: art is
  anchored to the bottom-left of the footprint, so any extra rows are drawn
  above it — that is where a roof, an overhang or a sign goes.
- Character sheets: 16×32 per frame; 4 directions × 3 walk frames; fixed
  row order down, left, right, up.
- Placeholder people accept a `look`, so a cast reads as a cast before anyone
  has painted a frame. It goes on an episode NPC, and on `world.json`'s
  `player`: `hair` (`flat`, `short`, `long`, `curly`, `ponytail`, `bun`,
  `cap`, `bald`), `hairColor`, `skin`, `shirt` — for which `accent` is the
  older spelling, still honoured — and `build` (`slim`, `regular`, `broad`).
  Every field is optional and falls back to the original townsperson, the
  vocabulary is fixed and validated (`engine/validate.ts`), and the engine
  owns every shape in it, so a world pack ships no pixels for one. A painted
  sheet replaces the placeholder outright and the `look` is then ignored.
- Portraits: 96×96 bust on transparency.
- Tools: Aseprite or Piskel (free, browser). Later: "Studio," a hosted
  constrained editor (locked canvas + palette + submit) — out of scope now,
  but nothing in the pipeline may preclude it.
- Credits live in `worlds/<id>/credits.json` (optional, graceful fallback —
  no file means no credits), validated by `validate-assets`. Each entry is one
  name, or an array of names in order of contribution when more than one
  person painted or touched up the same building; `engine/session.ts`
  `creditFor` joins either shape into one line ("Tom", "Tom and Lana", "Tom,
  Lana and Alice"). A painter is thanked in-game on the little plaque beside
  that building's door (§2), and listed on the site's front page under each
  world ("Painted so far"). A credit is never appended to a building's sign
  dialogue: that box is for the episode's copy.
- Intake now: files land in the repo by PR/commit with credit in the commit
  message → surfaced as "painted by ___" on the site. Later: Cloudflare Worker
  accepts uploads from Studio, validates, and opens a PR automatically.
  Moderation = PR review. No database anywhere.

## 5. Route 10 content facts (verified via search, Sep 2026)

**Geography (road names and junctions from OpenStreetMap, Sep 2026 — the
queries and the lat/lon → tile maths are in `docs/route10-geometry.md`):**

- **Stamford.** NY 10 and NY 23 cross at 42.41028, -74.62490. North of that
  corner NY 10 is **Lake Street**, climbing north-east toward Mount Utsayantha
  and on to Jefferson; south of it NY 10 is **Hobart Road**, leaving the
  village to the **south-west**. NY 23 runs east–west through the corner as
  **Harper Street**, and becomes **Main Street** a few hundred metres east,
  where it swings south-east down to the business block. **Stewart's is on the
  north-west corner of the 10/23 junction; Mac-A-Doodles (33 Harper St) is
  diagonally opposite it, on the south side of 23.** East and west of the
  village Route 23 runs on out of the map — no destinations there yet. The
  **West Branch Delaware River** is first mapped just south-east of the
  village and runs off to the south-west; NY 10 follows it down to Hobart.
- **Jefferson.** NY 10 meets Main Street at 42.48134, -74.61015. NY 10 leaves
  that junction **north** (toward Summit) and **east** — and it is the *east*
  arm that swings south a mile or two later and becomes the road to Stamford,
  so the drive to Stamford starts by heading east out of the village.
  West of the junction the road through the village is **Main Street**
  (OSM carries it as county route 2A). Heartbreak Hotel (149 Main St) is on the
  **north** side; **Middle Brook Cafe and the Mill Pond Inn are on the south
  side**, as are the **Village Green and gazebo**; **Creamery Street** runs
  south from Main past the Maple Museum. Jefferson Town Hall's OSM address puts
  it about 600 m **west** of the green, alone on the north side of Main. OSM
  maps no pond in the village, so the **mill pond's position is our guess** —
  south of Main at the west end of the village core, with the Mill Pond Inn on
  its west rim.
- **Hobart.** NY 10 is the village's **Main Street**, running south-west to
  north-east: **West Main Street** out to the west, **Main Street** through the
  book-village block, then **East Main Street** climbing **north-east** to
  Stamford. **Maple Avenue** drops south from Main, crossing the **West Branch
  Delaware River**, which curls round the east and south sides of the village.
  Cornell Avenue leaves the Main/East Main bend to the south-east.

**Map scale.** Each village map is fitted to that geometry at a fixed number of
metres per tile: Stamford 64×34 tiles at 20 m (1280×680 m), Jefferson 64×30 at
20 m (1280×600 m), Hobart 52×30 at 15 m (780×450 m). Building footprints are
deliberately much larger than life at that scale — they are landmarks, not
survey outlines.

**The maps are simplified for readability, on purpose.** Intelligible first,
accurate second: through roads are paved and 3 tiles wide with a dashed centre
line — the two state routes and Jefferson's Main Street, which is the village's
main street and reads as one — side streets are 2 tiles of sand, block faces
get their own concrete sidewalk tile, and every route is straight apart from a
single right-angle bend spent where it explains the real geography — no
staircase diagonals, no sandy aprons at the junctions. Sand is left for drives,
lots and forecourts, so it never has to stand in for pavement. The OSM
and USGS references the fit was worked from live in `playtest-out/reference`
and are not committed; the rules themselves are summarised in
`docs/route10-geometry.md` §7. Mount Utsayantha and its lake are just north-east of Stamford
up Lake Street, off the edge of the map — the Princess Utsayantha legend is
strong future-episode material.

**Nicknames (use on arrival cards):** Stamford — "Queen of the Catskills."
Hobart — "Jewel of the West Branch."

**Buildings** (id → notes for flavor/interiors):
- `mill-pond-inn` (Jefferson): inn + tavern; wood-fired pizza nights Mon &
  Wed; ribs sell out.
- `jefferson-town-hall` (Jefferson): limited posted hours; board-agenda humor.
- `heartbreak-hotel` (Jefferson): bar/restaurant (not lodging); famous
  Saturday prime rib; reservations urged.
- `middle-brook-cafe` (Jefferson, 170 Main St): café; pastry case empties by
  noon; the vegan chocolate chip cookie has a reputation.
- `stewarts` (Stamford, Lake St): gas/convenience/ice cream; opens ~4:30 AM;
  "costs more than Dunkin" debate is canon. Has the first interior; counter
  NPC **Hannah** (fictional, named for a praised real clerk — keep fictional).
- `mac-a-doodles` (Stamford, 33 Harper St): seasonal ice cream/burger stand;
  mac-n-cheese burger; pup cups.
- `stamford-coffee` (Stamford, 79 Main St): coffee shop; Maple Smoke latte
  (maple, liquid smoke, sea salt); attached Catskill Outpost shop.
- `the-belvedere` (Stamford): "The Bel," dive-bar community space; bat signs
  point to the patio; taco nights, movie nights, live music.
- `cellar-door-wines` (Hobart): curated wine shop; the owner's
  recommendations are an institution.

**Cast so far (fictional):** Earl — retired regular who holds court outside
Stewart's, Saturday crossword devotee. Hannah — Stewart's counter.

**Open items:**
- **Four map positions are guesses, not OSM.** Nothing in OpenStreetMap gives
  a location for the Mill Pond Inn or the mill pond itself (Jefferson), The
  Belvedere (Stamford) or Cellar Door Wines (Hobart), so those four sit on the
  right street in the right village but at a guessed spot along it. They are
  listed in `docs/route10-geometry.md` and are a one-line data fix once Tom
  confirms where they really are.
- The real roadside sign when leaving Stamford — wording believed to be
  "please drive with equanimity" or similar; **unverified, Tom will
  photograph it.** Use placeholder copy on that travel edge with a TODO.
- Friendly heads-up conversations with named businesses before public
  launch (Tom's task). Per-building fictional fallback names must be a
  2-minute data change if anyone objects.
- Custom palette commission; landmark facade + core cast commissions.

## 6. Community & policy

- Story intake: low-friction (site page, email; later Studio). Contributor
  note: contributions are used/adapted with credit. Credit lines at episode
  end ("this week's story from ___") and, for art, on the plaque beside that
  building's door and on the site's front page.
- Real businesses: name + neutral/affectionate flavor only; opt-in for
  speaking roles/interiors beyond flavor. Real people appear only by opt-in
  ("get pixelated into Route 10").
- Second world planned: `worlds/hs/` (private, friends-only; Cloudflare
  Access email gate). It is the proof that engine/world separation works.
  Nothing route10-specific may leak into the engine.

## 7. Roadmap

- **M0 — Feel check.** The smallest thing Tom can run and judge: `npm run dev`,
  one playable build with the three villages, travel interstitials, ep000
  from JSON, Stewart's interior, touch + keyboard input, placeholder art.
  Simple array-based maps are fine (Tiled deferred). No CI, no tests beyond
  what's needed to work, no devcontainer, no deploy — feel first, infra
  after Tom signs off.
- **M1 — Parity + foundations.** M0 hardened: Tiled maps replace array maps,
  Vitest coverage for schema/loader/flags, validate-episodes script, GitHub
  Actions (typecheck, tests, validation), devcontainer. (The public URL
  already exists: GitHub Pages deploys `main` on every push, see
  `.github/workflows/pages.yml`. Cloudflare Pages is deferred.)
- **M2 — Pipeline. Done.** Asset conventions live (drop a PNG → building
  painted), validate-assets + validate-episodes in CI, art credits in-game,
  save/load with episode completion, title screen.
- **M3 — Launch.** Custom palette + commissioned facades for all nine
  landmarks + core cast; 2–3 episodes banked; contribute page; domain.
- **M4 — Second world.** `worlds/hs` skeleton behind Cloudflare Access;
  fix whatever engine leaks it exposes.
- **M5 — Studio. Done, in its simplest form:** browser pixel editor, submission
  by mailto (the drawing travels as a text code in the mail body) and
  `npm run decode-art` to land it in the repo. No Worker and no Turnstile —
  there is nothing hosted to protect, and no account anywhere (hard rule 7).