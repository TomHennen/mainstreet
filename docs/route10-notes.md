# Route 10 notes: local knowledge and map rules

Facts from Tom, who knows these villages, plus the rules we settled on for
drawing them. Tom's word beats OpenStreetMap wherever they differ. Keep this
file current when he corrects a map; it is what every agent reads first.

## Ground truth

**Regional.** NY Route 10 runs north to south: Jefferson at the north end,
then Stamford, then Hobart south-west of Stamford along the West Branch of the
Delaware. Route 23 runs east to west through Stamford and *is* Main Street in
the village. Route 10 does not really pass through Harpersfield; never mention
it.

**Stamford.** Stewart's is on the north-west corner of the 10/23 junction.
Mac-A-Doodles is on the east side of Route 10, south of Route 23 (the
south-east corner). Route 23 is Harper Street west of the corner and Main
Street east of it; Route 10 is Lake Street north of the corner and Hobart Road
south of it. Stamford Coffee is on the south side of Main Street. The
Belvedere is up Academy Street, a long walk uphill from Main Street, and
Academy Street is west of Stamford Coffee. Mount Utsayantha and its lake are
north-east up Lake Street.

**Jefferson.** Main Street is the spine and reads as a main street (paved).
Mill Pond Inn and Middle Brook Cafe are on the south side of Main Street.
There is a gas station on the north side across from Middle Brook Cafe; a lot
is reserved for it. The village green with its gazebo is on the south side.
Route 10 leaves the junction north and east; the east arm is the road to
Stamford.

**Hobart.** Route 10 is Main Street, running south-west to north-east. The
village hugs the West Branch; Maple Avenue crosses it on a bridge.

**Stewart's interior.** The clerk is enclosed behind the counter; the player
talks across it and cannot walk round.

## Map rules (agreed 2026-09-06)

1. Intelligible first, accurate second. Bend the real geometry wherever the
   real one does not read on a tile grid, and say what was bent in
   `docs/route10-geometry.md`.
2. State routes: 3 tiles, asphalt, dashed yellow centre line that stops one
   tile short of every junction. Main streets that are not state routes are
   paved the same way. Side streets: 2 tiles, sandy. Sidewalks: concrete tile,
   contiguous, running to the corners of every block face they serve.
3. Roads are straight or have exactly one right-angle bend, spent where it
   explains the geography. Intersections are exact crossings or T junctions.
4. Minimal now, grown later. Only the roads and buildings episodes need.
   Keep map sizes generous, reserve full-size 5x3 empty lots on block faces,
   and never shift the grid: every position in world.json and the episodes is
   a tile coordinate.
5. Unnamed buildings: at most three or four per village, full size, only where
   they frame a block face. No small sheds, no scattered scenery; trees in
   bands, flowers in a few named patches.
6. Doors are drawn on the bottom edge of a facade (top-down convention). A
   business on the south side of an east-west street gets a lot and path that
   wrap round to its door.
7. Labels use the real street names and `NY 10` / `NY 23` (a bare "10" reads
   as "I0" in the pixel font).

## Critic rubric

Score each village 1 to 5, with one sentence of evidence each, before and after
a map change:

1. At a glance on a phone-sized window (about 12 tiles across), can you tell
   which road is the state route and where it leads?
2. Do intersections read as clean crossings?
3. Can you find the named businesses, and is the walk between them 5 to 20 s?
4. Is anything on screen that does not help the player?
5. Does it still feel like the real place (which side of the road things are;
   the one landmark shape people remember)?
6. Are there full-size open lots where future named buildings would go?

## Reference material

USGS aerial imagery and topo maps (public domain) and an OpenStreetMap road
schematic per village, plus the map generator, are produced into
`playtest-out/reference/` and `playtest-out/maps-work/` by scripts kept there
(gitignored, but they persist in the working tree). Overpass queries and the
lat/lon to tile maths are in `docs/route10-geometry.md`.

## People

No real private person appears by name without opting in (CLAUDE.md hard
rule 5). Signs refer to "the owner" or a fictional character.
