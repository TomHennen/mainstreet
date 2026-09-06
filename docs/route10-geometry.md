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

Roads are drawn as a band: every tile whose centre is within half the road
width of the polyline. State routes are 3 tiles wide, side streets 2.2–2.4,
rivers 2.0–2.6. That is a distance test rather than a stamp per step, so a
road that runs diagonally is exactly as wide as one that runs straight.

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
| `mill-pond-inn`    | jefferson | north side of Main at the west end of the village core        |
| the mill pond      | jefferson | south of Main, opposite the inn — OSM maps **no** water in the village |
| `the-belvedere`    | stamford  | north side of Main Street in the village block                |
| `cellar-door-wines`| hobart    | north-west side of Main Street, mid book-village block        |

`stamford-coffee` (79 Main St) is placed from its house number rather than a
mapped point: odd numbers are the south-west side of Main, and 79 sits just
east of 84 Main (the Village Hall), which is mapped.

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
