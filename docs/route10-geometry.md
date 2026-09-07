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
| stamford  | 64 × 34      | 20     | 1280 × 680 m   | NY 10/23 junction `42.41028, -74.62490` → (20, 12) |
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
- **Stamford: only one side street.** South Street is kept (it really does run
  south-east off Main); Railroad Avenue, West End Avenue, the Delaware Streets
  and the rest are dropped.
- **Jefferson: Park Avenue is gone.** At 20 m/tile it runs two tiles from Main
  Street and merges with it. The Village Green it loops around is drawn
  instead, as flowers, trees and a bench between Main and Creamery Street.
  Peck Street (CR 42, south from the junction) and Foote Road are dropped too.
- **Jefferson: Main Street's westward drop is stepped.** The real road falls
  about 140 m over 600 m going west; that is drawn as a stepped diagonal.
- **Hobart: the Catskill Scenic Trail is not drawn.** It runs right through the
  frame, parallel to Main Street, and would read as a second road. Worth adding
  later as a distinct path.
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
   move to add one. Eight in Stamford, four in Jefferson, three in Hobart.
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
