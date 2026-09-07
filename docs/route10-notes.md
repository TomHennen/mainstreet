# Route 10 notes: local knowledge and map rules

Facts from Tom, who knows these villages, plus the rules we settled on for
drawing them. Tom's word beats OpenStreetMap wherever they differ. Keep this
file current when he corrects a map; it is what every agent reads first.

## Ground truth

**Regional.** NY Route 10 runs north to south: Jefferson at the north end,
then Stamford, then Hobart south-west of Stamford along the West Branch of the
Delaware. Route 23 runs east to west through Stamford and *is* Main Street in
the village. Route 10 does not really pass through Harpersfield; never mention
it. Along Route 10 between Jefferson and Stamford stands the real **Parker
13-Sided Barn**: built 1896 by Richtmyer Hubbell, three stories, ~60 ft
diameter, double-hipped roof topped by a matching 13-sided cupola. It
supplied the two creameries in the Village of Jefferson as a dairy barn,
later served as a chicken barn and then a veal operation, and has been on
the National Register of Historic Places since September 29, 1984 — one of
only two 13-sided barns on the Register in this part of the state. Real
oddity, well documented, no living private person involved — strong future
episode or landmark material, alongside the Princess Utsayantha legend
(DESIGN.md §5). The **Catskill Scenic Trail** runs from Stamford to Hobart
(a former rail bed) — locals and tourists both bike and walk it, and it's a
standard thing for a visitor to do. Exact alignment relative to Route 10
not yet confirmed; worth checking against OSM/USGS when Hobart or the
Stamford-Hobart stretch next gets geometry work, since it's a real
alternate path between two villages the engine already models.

**Stamford.** Stewart's is on the north-west corner of the 10/23 junction.
Mac-A-Doodles is on the east side of Route 10, south of Route 23 (the
south-east corner). Route 23 is Harper Street west of the corner and Main
Street east of it; Route 10 is Lake Street north of the corner and Hobart Road
south of it. Stamford Coffee is on the south side of Main Street. The
Belvedere is up Academy Street, a long walk uphill from Main Street, and
Academy Street is west of Stamford Coffee. Mount Utsayantha and its lake are
north-east up Lake Street. The south-west corner of the 10/23 junction was
Hillhaven Farms, now closed — the owners retired to Alaska (upstate New York
winters weren't cold enough for them). Across Main Street from Stamford Coffee is a full
empty lot: two buildings there burned down a couple of years ago, and the
wreckage sat for years before it was finally bulldozed. It should be mapped
as one of the reserved full-size open lots (map rule 4), not filler scenery.
Stamford also has **Tops**, a grocery store, between Mac-A-Doodles and
Stamford Coffee. Current map block face may not actually have room for a
third full-size building there — flagged under Open items below for
whoever next redraws Stamford. It's the only grocery store within about 30
minutes, so locals lean on it even though it's rough around the edges
(produce that's a little iffy, regular items — jalapeños, say — often out
of stock). The genuine local feeling is gratitude that it's there at all,
not the gripe about what it's missing; see Flavor & story hooks for how
that has to land in-game.

**Jefferson.** Main Street is the spine and reads as a main street (paved).
Mill Pond Inn and Middle Brook Cafe are on the south side of Main Street.
There is a gas station on the north side across from Middle Brook Cafe; a lot
is reserved for it. The village green with its gazebo is on the south side.
Route 10 leaves the junction north and east; the east arm is the road to
Stamford.

**Hobart.** Route 10 is Main Street, running south-west to north-east. The
village hugs the West Branch; Maple Avenue crosses it on a bridge. Hobart is
a real **book village** — half a dozen or so independent bookshops on Main
Street, walkable end to end (real names on record: Adams' Antiquarian,
Book Nook, More Good Books, Creative Corner Books, among others — don't use
any of these in-game without the friendly-heads-up step in DESIGN.md §5).
The real designation only dates to the early 2000s (Don Dales began leasing
empty storefronts to booksellers around 2001-2005) — correction from an
earlier version of this note: the rule isn't "never reveal this," it's
**no anniversary/founding-date sign posted in the town itself**. A visible
"20 years of Book Village!" sign would read wrong to a visitor walking
through — it'd make the place feel newer than it feels. But the recency is
itself great story material: an episode about how Hobart became a book
village (empty storefronts, one bookseller taking a chance, others
following), or a beat where a townsperson casually surprises the player
with "you know this all used to be empty, right? Not that long ago
either" — that reveal-to-a-visitor moment is exactly the fun version of
this fact. So: keep it off physical signage, but it's fair game for
dialogue and even a future episode's whole premise. Hobart is currently
the least developed of the three
villages and is the natural place to grow bookshop lots over time — reserve
several full-size open lots along Main Street per map rule 4, and let named
shops fill in gradually rather than all at once.

**Stewart's interior.** The clerk is enclosed behind the counter; the player
talks across it and cannot walk round.

## Open items — pending map work

New businesses/landmarks Tom has named that aren't placed on the map yet.
Don't guess coordinates for these; they need a real Stamford redraw pass
(reference imagery + critic rubric, per the map rules below) rather than a
notes-file guess:

- **Tops** needs to fit on the Main/Route 23 block face between
  Mac-A-Doodles and Stamford Coffee. Tom's flagged that the current map
  likely doesn't have enough room there for a third full-size building —
  the block may need to be widened, the existing two buildings' lots
  tightened, or the block face re-thought.
- **Solinsky's** (butcher) — village and exact position not yet given.
- **The fire department** — west of Solinsky's, so Stamford, same
  unplaced block as Solinsky's; exact position not yet given.
- **John's Tavern** — almost certainly Stamford (Tom's contrasting it
  directly with the Belvedere's crowd), exact position not yet given.
- **TP's Cafe** and **Ace Hardware** — TP's is "off Railroad Ave, next to
  Ace Hardware." **Railroad Ave doesn't exist on the current map** — this
  is the first place a new street name will be needed; treat it as a
  geometry task (confirm the real alignment, add it to
  `docs/route10-geometry.md`, then the map) before placing either
  building.
- **Veterans Memorial Park** — a possible future addition; village and
  position not yet given. See the flavor note below on tone.
- **Hobart's bookshop lots.** Hobart is under-built relative to Stamford
  and Jefferson right now. Next time Hobart's map gets attention, reserve
  several full-size open lots along Main Street for bookshops — no need to
  name or place actual shops yet, just make sure the room exists so the
  village can visibly grow, episode by episode, matching map rule 4.

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

## Flavor & story hooks

Fun, true things about the area to draw on for episodes and ambient
dialogue. These are raw material, not finished copy — run anything derived
from them through hard rules 5 and 6 (no real private people without
opt-in, everything warm and affectionate) before it reaches the player.

- **The Belvedere ("the Bel").** From the outside it's the spookiest
  building in Stamford: big, visibly leaning, a single door tucked on a side
  wall that reads a little "sus," the kind of place that looks haunted. The
  building across the street somehow looks even more run-down. Inside,
  though, it's the warmest, friendliest dive bar going — karaoke, open mic
  nights, trivia, even big-name comics passing through. The gag writes
  itself: judge-a-book-by-its-cover, and the book is secretly lovely. Good
  for a "first time visiting" beat where a townsperson has to talk a
  newcomer into just opening the door.
- **Stamford Coffee.** Feels transplanted straight out of Brooklyn — hip
  crowd, always busy, good sandwiches and baked goods. A fun beat for a
  visiting-the-big-city-in-miniature moment, or a character who moved up
  from the city and feels instantly at home there. A prior owner once said
  he hadn't realized running a coffee shop meant really being in the milk
  business — a genuinely funny, true line about the unglamorous logistics
  behind a nice cup of coffee. Don't attribute it to a real named person
  (hard rule 5, and no name was given anyway); it works as something the
  current fictional owner or a longtime regular says, retelling it as
  local lore ("the old owner used to say...").
- **Middle Brook Cafe's lot.** Dollar General had been eyeing that land
  before the cafe went in — locals are quietly glad DG ended up down the
  road to the east instead. Frame this warmly (relief that the cafe is
  there), never as a knock on the Dollar General itself, which is a real
  business a few doors down.
- **Small-town density.** Wherever you are on Route 10, you will run into
  someone you know. Good recurring texture for episodes: NPCs who greet the
  player by name away from their "home" location, or a travel-card beat
  about running into a familiar face mid-errand.
- **The empty lot across from Stamford Coffee.** Two buildings burned down
  there a couple of years back, and the wreckage sat for a long time before
  it finally got cleared. Handle with care per hard rule 6 — never dwell on
  the fire itself. The lot as it stands now (bare, waiting, prime real
  estate everyone has an opinion about) is good material: a "what should go
  here" debate among townspeople, a pop-up farmers market or community
  garden using the space in the meantime, or a hopeful beat about something
  finally being planned for it.
- **Hillhaven Farms (closed).** Used to sit on the south-west corner of the
  10/23 junction in Stamford. The owners retired to Alaska — the joke being
  that upstate New York winters weren't cold enough for them. A fond,
  funny closure rather than a sad one; good for an affectionate aside from
  a local ("last I heard from them, they were shoveling snow in July and
  loving it") rather than a story about the business itself.
- **Tops (Stamford's grocery store).** Handle with extra care — hard rule 6
  is not optional here. The real local feeling is genuine gratitude: it's
  the only grocery store within about 30 minutes, and without it a lot of
  people would be driving 30-40 minutes each way for everything. Yes, the
  produce can be a little iffy and it doesn't always stock the basics
  (jalapeños have come up as an example) — but any copy drawn from that has
  to land as "we're so glad we have this place," with the quirks as
  endearing texture at most, never as a complaint about the store. A good
  test: would the person working the register smile reading it? If a line
  reads like a Yelp gripe, cut it. Good material for an NPC who's just
  relieved to grab dinner on the way home, not for a "the produce is bad"
  joke on its own.
- **NYC commuter culture.** A fair number of locals commute back and forth
  to New York City for work — train out of Albany is one route people use.
  Some do their "real" grocery run in the city or along the way home (a
  Friday Whole Foods stop, say) rather than at Tops. Good texture for a
  fictional commuter-archetype NPC (tired Friday-evening energy, a cooler
  bag from a city store, catching up on local news they missed all week) —
  not tied to any specific real person.
- **Solinsky's.** An excellent butcher — brisket sandwiches on Saturdays,
  and they genuinely sell out. Same "get there before it's gone" texture as
  the Mill Pond Inn's ribs joke already in ep000; a nice recurring town
  motif (good things in Route 10 run out, and everyone knows to plan
  around it). Good for a light "race the clock" beat without any real
  stakes.
- **John's Tavern.** The local counterpart to the Belvedere — a different
  crowd, less "Brooklyn transplant," more homegrown regulars. Not a
  rivalry, just two good bars with two different personalities; nice for a
  "which one's your spot" beat, or a townsperson explaining the difference
  to a newcomer without putting either place down.
- **TP's Cafe / Ace Hardware / Railroad Ave.** A new little corridor to
  open up on a future map pass — TP's sits off Railroad Ave next to Ace
  Hardware. Good candidate for a "there's a whole street I hadn't
  noticed" discovery beat once it's mapped.
- **Veterans Memorial Park.** Different register from the rest of this
  list — a memorial, not a business or a gag. If and when it's added,
  keep any copy quiet and respectful rather than cute; still warm, but the
  "everyone would smile at this" humor bar from CLAUDE.md hard rule 6
  mostly doesn't apply here. Good for a still, reflective beat (a bench, a
  flag, someone tending the flowerbeds) rather than a punchline.
- **The fire department.** Volunteer-run, and a lot of people end up
  joining who never expected to — including city transplants who moved up
  for a quieter life and somehow wound up as volunteer firefighters. Warm,
  slightly funny material: someone's whole self-image shifting ("I used to
  work in finance, now I show up when the siren goes"), or a proud, low-key
  local-hero energy around the department without making it a big dramatic
  thing. Ties nicely into the small-town-density and NYC-commuter notes
  above — this is the same kind of person who'd have that arc.
- **Catskill Scenic Trail.** Runs Stamford to Hobart along an old rail
  bed; a standard tourist thing to do, and plenty of locals bike or walk
  it too. Good material for a "visiting for the day" episode framing, a
  tourist NPC asking for directions, or simply an alternate way to
  narrate the travel-screen trip between those two villages (a bike ride
  along the trail instead of a drive down 10) once the geometry's mapped.
- **Jefferson Town Hall.** Dog licensing happens there, though hardly
  anyone actually goes and does it. Town court sits about once a month.
  Metal recycling drop-off is the first Saturday of the month. Good
  low-stakes bureaucratic-comedy texture for signs and board-agenda jokes
  (ep000's "the goat situation (continued)" is already in that vein) — a
  posted notice, a bored clerk, a "did you know" beat rather than a full
  episode on its own.
