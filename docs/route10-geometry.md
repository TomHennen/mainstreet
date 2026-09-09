# Fitting the Route 10 maps to the real roads

The three village maps in `worlds/route10/maps/` are not invented: their road
networks are the real ones, taken from OpenStreetMap in September 2026 and
simplified onto the 16 px tile grid. This note records the queries, the scale
and the lat/lon → tile arithmetic so anybody can re-fit a map later — move a
building, widen a village, add a street — and land it in the right place.

Nothing here is code the game runs. It is the recipe behind the data.

## 1. Where the data came from

All of it is one endpoint, `https://overpass-api.de/api/interpreter`, posted
with `curl --data-urlencode 'data=<query>'`. Be polite: a handful of queries,
a 25–60 s timeout, no loops.

**Roads, one village at a time** (`out geom;` gives every node of every way,
which is what the fitting needs):

```
[out:json][timeout:25];
(way["highway"](42.398,-74.630,42.420,-74.595););
out geom;
```

with the bounding box swapped per village:

| village   | bbox (south, west, north, east)          |
|-----------|------------------------------------------|
| Stamford  | `42.398,-74.630,42.420,-74.595`          |
| Jefferson | `42.470,-74.630,42.492,-74.600`          |
| Hobart    | `42.362,-74.685,42.384,-74.655`          |

For Jefferson and Hobart the same query also asked for water, since the West
Branch and Middle Brook matter:

```
(way["highway"](<bbox>);way["natural"="water"](<bbox>);way["waterway"](<bbox>););
out geom;
```

**Named places, all three villages in one query** (`out tags center;` is enough
— a single point per shop is all a tile grid can use):

```
[out:json][timeout:60];
(
  nwr["name"]["shop"](<bbox>);   nwr["name"]["amenity"](<bbox>);
  nwr["name"]["tourism"](<bbox>);nwr["name"]["office"](<bbox>);
  nwr["name"]["building"](<bbox>);
  … repeated for the other two bboxes …
);
out tags center;
```

**Chasing specific names** (used to check for a mill pond, The Belvedere,
Cellar Door Wines — all three came back empty):

```
[out:json][timeout:60];
(
  nwr["natural"="water"](42.470,-74.640,42.495,-74.595);
  nwr["landuse"="reservoir"](42.470,-74.640,42.495,-74.595);
  nwr["leisure"="park"](42.470,-74.640,42.495,-74.595);
  nwr["name"~"Mill Pond|Belvedere|Cellar Door|Middle Brook|Stamford Coffee",i]
     (42.35,-74.72,42.52,-74.55);
);
out tags center;
```

## 2. What the roads actually are

The names below are OSM's, and they are what the map labels say.

**Stamford.** NY 10 × NY 23 at **42.41028, -74.62490**.

- NY 10 north of the junction = **Lake Street**, climbing north-east to
  `42.41999, -74.62086` and on north as State Highway 10 toward Jefferson.
- NY 10 south of it = **Hobart Road**, leaving **south-west** through
  `42.40761, -74.62763` and running down the West Branch to Hobart.
- NY 23 through the junction = **Harper Street**, roughly east–west, which
  becomes **Main Street** at `42.41055, -74.62037`; Main Street then runs
  south-east down to the business block (`42.4077`-ish) before flattening out
  east.
- Stewart's (OSM node 365214735, `42.41053, -74.62488`) is a hair north of the
  junction: the **north-west corner**. Mac-A-Doodles (`42.40994, -74.62485`)
  is on the south side of 23, diagonally opposite.
- Other fixed points used for the fit: Sacred Heart church, 27 Harper St
  (`42.41026, -74.62322`); Tops, 127 Main (`42.40994, -74.62068`); the library,
  117 Main (`42.41012, -74.62000`); Village Hall, 84 Main
  (`42.40863, -74.61698`); the post office (`42.40812, -74.61825`); Ace
  Hardware (`42.40770, -74.61640`).
- The **West Branch Delaware River** (way 134683215) is first mapped at
  `42.40955, -74.62138`, just south-east of the village, and runs off
  south-west from there.

**Jefferson.** Junction at **42.48134, -74.61015**.

- NY 10 leaves it **north** (`42.48222, -74.61023` → `42.48572, -74.61167`)
  and **east** (`42.48157, -74.60568` → `42.48182, -74.60092`). The east arm
  bends south a mile on and is the road to Stamford, so *Jefferson → Stamford
  starts by heading east.*
- West of the junction, through the village, the road is **Main Street** —
  OSM carries the whole county route as North Harpersfield Road (CR 2A); the
  house numbers on it in the village say Main Street, and Main Street is what
  the map labels.
- North side of Main: The Breakfast Club, 139 Main (`42.48133, -74.61357`),
  Heartbreak Hotel, 149 Main (`42.48136, -74.61255`). Numbers rise eastward,
  which puts Middle Brook Cafe (170 Main) east of Heartbreak.
- South side: the **Village Green at Jefferson** (way 543918588,
  `42.48091, -74.61251`) with its gazebo, the post office on Park Avenue and
  the Maple Museum on **Creamery Street**, which runs south from Main at
  `42.48119, -74.61333`.
- Jefferson Town Hall, 677 North Harpersfield Road (`42.48026, -74.62066`) —
  about 600 m west of the green, on the north side of the road.

**Hobart.** NY 10 *is* the village street, running south-west to north-east.

- **West Main Street** from `42.37271, -74.68009` in to
  `42.37148, -74.67091`; **Main Street** from there to
  `42.37336, -74.66782`; **East Main Street** from that bend up north-east
  through `42.37840, -74.66455` and on to Stamford.
- **Maple Avenue** leaves Main at `42.37160, -74.66977` heading south-south-
  east, crossing the West Branch, past the town hall (101 Maple Ave) and the
  bank (147 Maple Ave). **Cornell Avenue** leaves the Main/East Main bend to
  the south-east.
- The **West Branch Delaware River** runs right past the village: it comes
  down the east side (`42.37374, -74.66597` → `42.37251, -74.66811`) and turns
  west below Main Street (`42.37127, -74.66973` → `42.37094, -74.67164`).

## 3. Scale and the lat/lon → tile mapping

Each map picks a metres-per-tile and an anchor: one real point pinned to one
tile. Everything else follows.

```
x = anchor_x + (lon - anchor_lon) * (111320 * cos(anchor_lat)) / metres_per_tile
y = anchor_y - (lat - anchor_lat) *  111320                    / metres_per_tile
```

| map       | size (tiles) | m/tile | ground covered | anchor                                            |
|-----------|--------------|--------|----------------|---------------------------------------------------|
| stamford  | 96 × 42      | 20     | 1920 × 840 m   | NY 10/23 junction `42.41028, -74.62490` → (20, 12) |
| jefferson | 64 × 30      | 20     | 1280 × 600 m   | NY 10 junction `42.48134, -74.61015` → (52, 12)    |
| hobart    | 52 × 30      | 15     | 780 × 450 m    | Main/West Main `42.37148, -74.67091` → (18, 22)    |

Degree-to-metre factors at those latitudes: Stamford/Jefferson
`82,220 m` and `82,090 m` per degree of longitude; Hobart `82,240 m`.
Latitude is `111,320 m` per degree everywhere.

Those anchors are the *first* fit, and §7 supersedes how the roads are drawn
from them: the readability pass replaced the fitted polylines with axis-aligned
rectangles, so a route is now exactly 3 tiles wide (side streets exactly 2)
everywhere, and the junction tiles sit a little off the arithmetic above. The
scale, the sizes and the sides of the street are unchanged, so the table is
still the right starting point for re-fitting anything.

## 4. What was simplified, and why

Honest list, so the next pass knows what it is allowed to undo.

- **Buildings are far bigger than life.** At 20 m/tile a real Stewart's is
  about 1.5 × 1 tiles. Footprints are 5–8 tiles wide so the placeholder facade
  and its name sign are legible. Buildings are landmarks here, not outlines.
- **Every door faces south.** The engine's placeholder facade draws the door
  on the bottom edge (`engine/art.ts`), so a building on the south side of an
  east–west street is entered from behind. Those buildings get a walkable
  margin all round; the side of the street each one is on is still the real
  one.
- **Stamford: NY 23 west is flattened.** Harper Street really climbs steeply
  north-west out of the village and would leave the frame through the top-left
  corner. It is bent to a gentle north-west grade that leaves the west edge, so
  the "23" label reads as the east–west route it is. Harper's slight southward
  sag between the junction and Main Street is straightened out.
- **Stamford: Hobart Road is straightened.** The real road's bearing would put
  it off the west edge; it is held to a steady south-west diagonal so it
  reaches the south edge near the corner, which is where the Hobart exit sits.
- **Stamford: three side streets.** Academy Street runs north off Main to The
  Belvedere; Churchill Avenue runs south off Main to Railroad Avenue, which
  runs east–west parallel to Main and carries Ace Hardware and T.P.'s Cafe.
  West End Avenue, the Delaware Streets and the rest are still dropped.
- **Jefferson: Park Avenue is gone.** At 20 m/tile it runs two tiles from Main
  Street and merges with it. The Village Green it loops around is drawn
  instead, as flowers, trees and a bench between Main and Creamery Street.
  Peck Street (CR 42, south from the junction) and Foote Road are dropped too.
- **Jefferson: Main Street's westward drop is stepped.** The real road falls
  about 140 m over 600 m going west; that is drawn as a stepped diagonal.
- **Hobart: the Catskill Scenic Trail is not drawn.** It runs right through the
  frame, parallel to Main Street, and would read as a second road. Worth adding
  later as a distinct path. *(Superseded by §11: it is drawn now, one tile
  wide, coming in at the top edge rather than running the length of the
  village.)*
- **Hobart: one of the two small mapped ponds east of the village** is kept; the
  other is under a tile wide at this scale and rendered as a puddle, so it went.
- **All three: unnamed footprints.** The small two-tone blocks along each street
  are anonymous neighbours — houses and storefronts with no name and no sign.
  In Stamford several sit at real mapped positions (the church on Harper, the
  supermarket and library on Main, the post office); elsewhere they are there to
  make a street feel lived on. Only the nine buildings in `world.json` are ever
  named (CLAUDE.md hard rule 5).

## 5. Positions OSM could not give us

These four are on the right street in the right village, at a guessed spot
along it. Each is a one-line change in `world.json` once confirmed.

| id                 | map       | guessed as                                                   |
|--------------------|-----------|--------------------------------------------------------------|
| `mill-pond-inn`    | jefferson | south side of Main, on the pond's west rim                    |
| the mill pond      | jefferson | south of Main at the west end of the village core — OSM maps **no** water in the village |
| `the-belvedere`    | stamford  | at the top of **Academy Street**, its own side road north off 23 |
| `cellar-door-wines`| hobart    | north-west side of Main Street, mid book-village block        |

`stamford-coffee` (79 Main St) is placed from its house number rather than a
mapped point: odd numbers are the **south** side of Main, so it sits on the
south face with a drive and a walk round to its door.

## 6. Re-fitting a map

1. Re-run the relevant query from §1 and pick the points you care about.
2. Convert with the formula in §3 using that map's anchor and scale — or pick a
   new anchor and scale and write it into the table.
3. Move the road polylines and the `world.json` placements together: a
   building's `door` must be the tile directly below its footprint, and both
   must be off any solid tile.
4. `npm run validate-episodes`, `npm test`, `npm run playtest`. The playtest
   BFS-pathfinds the whole of ep000 over the tile grids, so if it cannot reach
   something the layout is wrong, not the harness.

## 7. Readability pass (Sep 2026)

The first fit put the real road geometry on the grid faithfully, and it read
badly: every road — state route, side street, driveway, parking apron — was
the same 3-tile beige staircase, so nothing told a player which line was
Route 10. The maps were re-laid to be **intelligible first and accurate
second**. The rules, in full:

1. **Through roads are paved.** 3 tiles wide, asphalt, with a dashed yellow
   centre line on the middle tile — the two state routes, and Jefferson's Main
   Street, which is county route 2A rather than a state route but is the
   village's main street and reads as one. Side streets are 2 tiles wide and
   sandy. **Block faces get a concrete sidewalk** (its own pale tile), running
   the length of the face it serves and ending against the asphalt at the
   junction; sand is left for drives, lots, forecourts and side streets, so it
   never has to stand in for pavement.
2. **Straight, with at most one bend.** Each state route gets a single
   right-angle bend, spent where it explains the real geography — Stamford's
   NY 10 turns west low on the map so the Hobart exit sits in the south-west
   corner; Jefferson's NY 10 comes down from the north and turns east; Hobart's
   Main Street runs in from the west and climbs north out of the frame. No
   staircase diagonals anywhere.
3. **No aprons.** Junctions are exact 3×3 (or 2×3) right-angle blocks, and the
   centre-line dash stops one tile short of the block on every arm, so a
   crossing reads as a crossing.
4. **Filler is full size.** 3–4 unnamed buildings per village, 4×3 or 5×3, on a
   block face, so any of them can be renamed into a real business with a
   one-line change in `world.json`. The old 3×2 sheds are gone.
5. **Reserved lots.** 5×3 patches of plain grass — no tree, no flower, no prop
   — on the block faces where a future named building goes, so nothing has to
   move to add one. Four in Jefferson, three in Hobart; Stamford's are the
   north side of Main east of x49 and the empty lot at x34 (§9).
6. **Scenery is deliberate.** Trees in bands (hillsides, map edges, the ring
   round Jefferson's Village Green), never a uniform sprinkle; flowers in a
   handful of named patches; label boxes are kept clear so a road name stays
   readable.

Two engine facts constrain all of it: the camera budget is 17×13 tiles at
zoom 2, and **every building door faces south** (`engine/art.ts` draws it on
the bottom band of the facade), so a business fronting the south side of an
east–west road needs a short sandy drive or lot linking the road round to its
front. Mac-A-Doodles in Stamford is the worked example.

`playtest-out/maps-work/gen.py` generates all three maps from these rules and
checks them: road widths, asphalt/sand contact only at declared access points,
no staircase, reachability of every door and every ep000 position, reserved
lots plain, minimum building size. It is a working file and is not committed.
The OSM and USGS reference sheets it was fitted against live in
`playtest-out/reference`, also uncommitted.

What this cost in accuracy is listed in §4 above, plus: Stamford's NY 10 and
NY 23 are both dead straight instead of diagonal; The Belvedere has moved off
Main Street to the top of **Academy Street** — a real Stamford street, drawn
here west of Stamford Coffee rather than at its real place east of the centre;
Hobart's Main Street is a west arm plus a north arm rather than one long
diagonal; and Jefferson gained the Village Green and gazebo it should always
have had.

Inside Stewart's, the counter's open end is closed with a short return so the
player cannot walk behind the register; Hannah stands in the last gap and
serves across the counter (interior NPC reach is 2.3 tiles).

## 8. The cafe patios (Sep 2026)

Both cafes have an outdoor patio, a parking lot, and — at Middle Brook — an
herb garden, and Tom's notes say where each one is. They are drawn as map
tiles and props rather than baked into a building PNG, so an artist painting a
facade never has to paint the ground it stands on. Five tiles were appended to
the tileset for them (ids 33-37): a wooden patio deck, a cafe table, a
planter, an herb bed, and asphalt with a white parking-stall stripe. The
table needed one new engine drawing recipe, `disc` — a round top on an inner
square, generic enough for a table, a stool or a barrel; everything else
reuses a recipe that was already there.

**Stamford Coffee** (`stamford`, footprint x44-48 y20-22, door 46,23). The
patio is the 5x3 deck at x44-48, y23-25, attached to the facade, with three
tables and two planters at its front corners. Main Street's south-side
sidewalk runs *through* its top row rather than round it: a patio the pavement
crosses is what "directly attached to the front" looks like from above. The
lot is x49-54, y20-22 with a two-tile drive at (49-50, 19) onto Main Street —
the old sandy drive, paved and widened. The narrow drive matters: a six-tile
mouth would have read as a junction, and the centre-line dash runs straight
past this one, which says it is not. The reserved 5x3 lot that stood at
(52, 20) moved east to (55, 20), and the row-23 sidewalk was run out to x59 to
serve its block face.

**Middle Brook Cafe** (`jefferson`) **moved three tiles south**, from y16 to
y19 — door (45, 19) to (45, 22). The real cafe fronts Main Street, so this is
a deliberate bend, and it buys the herb garden: the painted facade is a tile
taller than its footprint and the floating name plate sits a tile above that,
so anything drawn in the two rows behind the building is invisible. Three rows
back, the garden shows. It is the bed at x42-48, y16-18, between the cafe and
Main Street — which is "round the back" in the player's terms, since the
engine puts every door on the south face. In front: the parking lot at
x42-44, y22-25, opening straight onto Creamery Street so it needs no lane of
its own; the concrete walk down column x45 from the door; and the patio, a 5x4
deck at x46-50, y22-25 with four tables and two planters. The old sandy
"south-side lot" — twelve tiles by two of undifferentiated sand at y19-20,
serving nothing — is gone.


## 9. Stamford's Main Street block (Sep 2026)

Tom's ground truth put nine more named places on one block face, plus a side
street that did not exist on the map at all. The village grew **east and
south only** — 64 × 34 to **96 × 42** — so every tile that had a coordinate
kept it, and nothing in `world.json` or an episode had to move except the
things this pass deliberately moved.

Everything named is on the **south** side of Main, in Tom's order west to
east, each with its door on the wrap-around sidewalk at y23:

| id                         | pos      | size  | door     |
|----------------------------|----------|-------|----------|
| `mac-a-doodles`            | 24, 21   | 4 × 3 | 25, 24   |
| *(unnamed filler)*         | 30, 20   | 4 × 3 | —        |
| *(empty lot)*              | 34, 20   | 5 × 3 | —        |
| `tops`                     | 39, 20   | 6 × 3 | 42, 23   |
| *(Tops' parking)*          | 45, 20   | 4 × 3 | —        |
| `stamford-library`         | 53, 20   | 5 × 3 | 55, 23   |
| `stamford-fire-department` | 59, 20   | 6 × 3 | 61, 23   |
| `solinskys`                | 66, 20   | 5 × 3 | 68, 23   |
| *(Veterans Memorial Park)* | 72, 20   | 3 × 3 | —        |
| `johns-tavern`             | 79, 20   | 5 × 3 | 81, 23   |
| `eighty-main`              | 85, 20   | 2 × 3 | 85, 23   |
| `stamford-coffee`          | 87, 20   | 5 × 3 | 89, 23   |
| `tps-cafe`                 | 53, 26   | 5 × 3 | 55, 29   |
| `ace-hardware`             | 59, 26   | 5 × 3 | 61, 29   |
| `the-belvedere`            | 78, 2    | 5 × 3 | 80, 5    |

**Deliberate bends, on top of §4 and §7.**

- **Distances are compressed.** Fitted at 20 m/tile the block would run past
  the frame: Stamford Coffee's real position is about x66, and it is drawn at
  x87 so that eleven storefronts, a supermarket lot, a park and a side street
  all get a full-size footprint. Storefronts touch or leave a one-tile gap;
  the gaps are for legibility, not for scale.
- **Academy Street moved east**, from x40–41 to x76–77, so that the block face
  west of it has room for Tops, the library, the fire department, Solinsky's
  and the park. The Belvedere moved with it, from (42, 2) to (78, 2). It is
  still west of Stamford Coffee, which is what Tom's notes require.
- **NY 10 runs straight south to the bottom edge** and its west arm is gone,
  so the map's one bend is spent on nothing at all: the road is dead straight
  north to south. The `stamford-hobart` exit moved from the west edge
  (`[0, 30, 1, 3]`) to the bottom edge (`[20, 41, 3, 1]`), and Hobart's return
  spawn from `[1, 32]` to `[21, 40]`. Hobart is south-west of Stamford, so
  leaving southward is no worse a lie than leaving westward was.
- **The West Branch moved south**, y27–28 to y37–38, to leave room for
  Railroad Avenue and the trail. Its west end steps down over four tiles
  instead of stopping square.
- **The Catskill Scenic Trail is drawn** — one sandy tile at y33, on the old
  rail bed. One tile wide against a side street's two and a route's three, and
  labelled, so it reads as a path. §11 supersedes where it goes: it no longer
  crosses NY 10, and it now turns south to leave the map for Hobart.
- **Stamford Coffee's patio and lot moved with it.** The deck is now 7 × 3 at
  x85–91, y23–25, shared with 80 Main, which touches Coffee's west wall; the
  lot is x92–95, y20–25 with a two-tile drive at (92–93, 19). §8's coordinates
  for it are superseded.
- **The empty lot** at x34–38, y20–22 is a real parking lot in Stamford. It is
  drawn as plain grass with no label, so it also serves as map rule 4's
  reserved lot for whatever goes there.
- **Mountain Dog Cafe is not named.** The unnamed filler at x30–33 is its
  building; it is closed and Tom's word is to wait.

## 10. Two more interiors (Sep 2026)

Stamford Coffee and The Belvedere have rooms behind their doors, built with
`scripts/make-room` from the specs in `worlds/route10/rooms/` (DESIGN.md §2).
They keep Stewart's scale — a 6 × 4 footprint bought a 28 × 16 room there,
about four and a half tiles of room per tile of frontage — so Stamford
Coffee's 5 × 3 front bought 20 × 12 and the Belvedere's the same front bought
22 × 14. The Bel is the bigger of the two on purpose: from outside it is the
big leaning building on Academy Street, and inside it is a room with a stage
in it.

Both doorways are two tiles wide in the bottom wall, matted, with the exit
trigger on the mat and the spawn tile the mat just inside it — the way out of
Stewart's, and the reason a room's door reads as a door.

- **Stamford Coffee** (20 × 12, exposed brick, light floor; rebuilt to Tom's
  notes, Sep 2026): the counter runs along the back wall with the menu board
  at its right-hand end and the coffee-maker collection on the shelf past it;
  the record player and the crates of LPs down the left wall; tables in two
  clusters either side of the aisle from the door; the self-serve fridge up
  front by the door; and, in the **right** wall, a two-tile open doorway
  straight through into **80 Main**'s own room.
- **80 Main** (14 × 12, same brick and floor): its own street door onto the
  shared patio, the counter along the back, the logo wear, the sweater rack,
  the candles and mugs round the walls, the coal coffee table in the middle
  and the oyster-and-wine board by the door; the doorway back into the coffee
  shop is in its **left** wall, lined up with Coffee's.
- **The doorway is on the room's right, though 80 Main is west on the
  street.** A deliberate bend (map rule 1). Every interior here is entered
  through its bottom wall and walked *up* into, whatever way the real door
  faces, so a room's x-axis carries no compass meaning; what it can match is
  the player's body. Stamford Coffee is on the south side of Main, so in life
  you walk in facing south and 80 Main, to the west, is on your right — which
  is what Tom wrote and what the room does. Walking through and out 80 Main's
  street door puts you four tiles west of where you went in, which nobody
  notices across a fade.
- **The Belvedere** (22 × 14, dark panelling): the bar runs down the west side
  with a sealed strip behind it, the stage sits in the north-east corner with
  the floor in front of it left clear, a chalkboard stands by the north wall
  for whatever is on tonight, coolers line the east wall, and the tables are
  scattered rather than ranked. Nobody is placed in either room yet; both are
  ready for one.

The tileset gained three tiles for these (ids 43-45): a stage floor, the same
planks again for the stage's near row with the riser's front face on it, and a
standing board. A bar top is the wooden counter tile over again.

## 11. The scenic trail bends south (Sep 2026)

Tom's ground truth for the Catskill Scenic Trail, which §9 had drawn as a
straight sandy line across the whole Stamford map: **between Stamford and
Hobart the old Ulster & Delaware rail bed stays east of Route 10 and west of
the West Branch of the Delaware.** It threads the valley between the road and
the river and never crosses the highway. So the trail no longer crosses NY 10,
and it is now a way to get to Hobart rather than scenery.

**Stamford (96 × 42).**

| what                    | tiles                                      |
|-------------------------|--------------------------------------------|
| trail, east–west        | y33, x24–95 (unchanged east of the bend)   |
| the bend                | (24, 33)                                   |
| trail, north–south      | x24, y33–41                                |
| footbridge              | (24, 37) and (24, 38)                      |
| grass gap from NY 10    | x23, y33–41 (water at y37–38)              |
| NY 10's own bridge      | x20–22, y37–38                             |
| `stamford-hobart-trail` | exit at [24, 41, 1, 1] → hobart, spawn (36, 1), facing down |

- **West of NY 10 the trail is gone.** y33, x0–19 is hillside grass again,
  with the same scattered trees as the bands at y32 and y34. The
  `stamford-trail-west` road end went with it; `stamford-trail-east` at
  (95, 33) stays, because the rail bed really does keep running east.
- **One tile of grass separates the trail from the road.** NY 10 occupies
  x20–22; x23 is left clear the whole way down so the two lines never touch
  and never read as one four-tile road.
- **The West Branch now runs the full width of the map.** It used to stop in
  the grass at x30/x34 (§9's "steps down over four tiles"), which left the
  trail's new southward run with nothing to cross. The river is a real
  through-flow — it comes down the valley from the east and runs on
  south-west to Hobart — so y37–38 is water from x0 to x95, and both lines
  cross it: NY 10 on a 3 × 2 bridge deck at x20–22, the trail on a 1 × 2
  footbridge at x24, one tile of water between them. Real NY 10 crosses the
  West Branch several times on the way down to Hobart; this is the first of
  them, drawn where the map can show it. **What this cost:** the road's
  dashed centre line breaks for the two rows of the bridge, and the river's
  stepped west end is gone.
- **South of the water the trail is on the river's far side.** Stamford's
  West Branch is drawn as one east–west band across the bottom of the map, so
  anything heading south has to cross it; in the real valley the rail bed
  stays on the near side of the water for a good while yet and crosses much
  further down. The footbridge is where that crossing got spent.
- **A mown verge either side of the trail.** The trees at y32 and y34 are
  cleared from x24 to x44, and at (25, 41). A one-tile path with a wall of
  trees along both sides has nowhere for two people to pass: a townsperson
  walking the trail would path all the way out to NY 10 to get round the
  player. Grass either side is both what a rail-bed trail looks like and
  what lets somebody step aside.

**Hobart (52 × 30).** Here the real alignment lands on the grid almost by
itself: NY 10 comes down x32–34 and the West Branch comes down x38, so there
is a three-tile corridor between them and the trail takes the middle of it.

| what                    | tiles                                      |
|-------------------------|--------------------------------------------|
| trail                   | x36, y0–19                                 |
| grass gaps              | x35 (from the road) and x37 (from the river) |
| spur onto Main Street   | (35, 19), touching the asphalt at (34, 19) |
| trailhead marker        | stele at (35, 18)                          |
| benches                 | (37, 19) and (35, 20)                      |
| `hobart-stamford-trail` | exit at [36, 0, 1, 1] → stamford, spawn (24, 40), facing up |

- **The trailhead is at the east end of Main Street, not north of it.** NY 10
  runs down the map to y18 and only then turns west as Main Street, so there
  is no block face north of Main east of the highway to put a trailhead on.
  The trail comes down past the junction instead and lands beside Main's east
  end, which is where somebody coming off the rail bed would actually step
  onto the street.
- **The label is short.** Stamford's says `CATSKILL SCENIC TRAIL`; Hobart's
  says `SCENIC TRAIL` at (37, 9), because the full name centred on a
  three-tile corridor would print across both NY 10 and the river.
- **Trees in the corridor were cleared at y14–20** on x35 and x37, so the
  trailhead reads as a path arriving rather than a gap in the woods. The
  bands at the top of the map are untouched.

Both exits use `style: "road"`, so they show the same travel card the drive
does, with their own copy under `transitions` in `copy.json`
(`stamford-hobart-trail`, `hobart-stamford-trail`). The `stamford-hobart`
and `hobart-stamford` road exits, and everything else on either map, are
unchanged.

## 12. J&H's forecourt (Sep 2026)

ep002 ends with Walt driving down the valley, which meant the map needed
somewhere on it a truck could legally stand: a parked vehicle has to sit on a
drivable tile (`engine/validate.ts`), and J&H's apron was sandy. Jefferson's
row 12 between the sidewalk (x38–41) and NY 10 (x48–50) is now the gas
station's paved forecourt.

| what                | tiles                                            |
|---------------------|--------------------------------------------------|
| forecourt           | row 12, x42–47 — asphalt, one speck tile at x47   |
| stall stripes       | (42, 12) and (44, 12), the white `stripe-v` tile  |
| the marked stall    | (43, 12) — where ep002 parks Walt's pickup        |
| J&H's doorstep      | (45, 12), unchanged                               |
| J&H's plaque tile   | (46, 12), unchanged                               |

- **Two stripes and one stall**, the same pattern the Middle Brook lot uses at
  x42–44, y24–25. The stall is at the west end, away from the door and the
  plaque, so a truck's 32 px sprite never sits over either of them.
- **It opens straight onto Main Street.** Row 13 is asphalt the whole way
  across, so the forecourt needs no drive of its own: a truck in the stall
  pulls south into the westbound lane and away. Nothing else on the map
  moved, and no coordinate changed.
- **The way out of the village is east.** NY 10 comes down x48–50 and turns
  east along Main Street, so a truck "heading south" in the fiction — down the
  valley toward Stamford and the city — drives east along row 15, the
  eastbound lane the ambient van uses, and off the map at x63, where the
  `jefferson-stamford` exit is. ep002's scene drives it (43,12) → (43,15) →
  (63,15).
