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
Academy Street is west of Stamford Coffee. Stamford Coffee has a big outdoor
patio directly attached to the front of the building, and a huge parking
lot. Mount Utsayantha and its lake are
north-east up Lake Street. The south-west corner of the 10/23 junction was
Hillhaven Farms, now closed — the owners retired to Alaska (upstate New York
winters weren't cold enough for them). Across Main Street from Stamford Coffee is a full
empty lot: two buildings there burned down a couple of years ago, and the
wreckage sat for years before it was finally bulldozed. It should be mapped
as one of the reserved full-size open lots (map rule 4), not filler scenery.
Stamford also has **Tops**, a grocery store, between Mac-A-Doodles and
Stamford Coffee. It's the only grocery store within about 30 minutes, so
locals lean on it even though it's rough around the edges
(produce that's a little iffy, regular items — jalapeños, say — often out
of stock). The genuine local feeling is gratitude that it's there at all,
not the gripe about what it's missing; see Flavor & story hooks for how
that has to land in-game. West of Tops was **Mountain Dog Cafe**, now
closed — see Flavor & story hooks for its story alongside Stamford Coffee.
**80 Main** is attached directly to Stamford Coffee, its own storefront
right next door on its **west** side, sharing that same front patio.

**Stamford's Main Street block (settled Sep 2026).** Everything named here is
on the **south** side of Main Street east of the NY 10 junction, and this is
the order west to east: Mac-A-Doodles; an unnamed filler on the spot where
**Mountain Dog Cafe** will go once it is named (it is closed, and Tom's word is
to wait); a full-size **empty lot** — a parking lot in real life, so it stays
plain open ground with no label and no story attached to it; **Tops**, bigger
than a shop, with a striped parking lot beside it; the **Stamford Library**;
the **Stamford Fire Department**, just west of **Solinsky's**; Solinsky's;
**Veterans Memorial Park**, a small green with a memorial; then **Academy
Street** running north off Main to The Belvedere; then **John's Tavern**;
then **80 Main** and **Stamford Coffee**, which touch and share one patio deck.
The library is on the **south** side, not the north. The north side of Main
keeps its unnamed fillers and its reserved open lots, including the burned-out
lot across from Stamford Coffee.

South of Main and west of Academy Street, **Churchill Avenue** runs down from
Main to **Railroad Avenue**, which runs east–west parallel to Main. **T.P.'s
Cafe** and **Ace Hardware** front Railroad Avenue near the Churchill corner,
and the **Catskill Scenic Trail** follows the old rail bed just south of them.

**Jefferson.** Main Street is the spine and reads as a main street (paved).
Mill Pond Inn and Middle Brook Cafe are on the south side of Main Street.
There is a gas station, **J&H** (`jh-gas-station` on the map, north of the
village green, roughly across Main Street from Middle Brook Cafe — placed Sep
2026), on the north side of Main Street. Middle Brook Cafe has a big outdoor patio in front, next
to its parking lot, and an herb garden round the back. The village green with its gazebo is on the south side.
Route 10 leaves the junction north and east; the east arm is the road to
Stamford.

**Hobart.** Route 10 is Main Street, running south-west to north-east. The
village hugs the West Branch; Maple Avenue crosses it on a bridge. Hobart is
a real **book village** — half a dozen or so independent bookshops on Main
Street, walkable end to end (real shop names on record — don't use any
in-game without the friendly-heads-up step in DESIGN.md §5). The
designation is recent (early-to-mid 2000s); full origin story and the rule
on how that recency may/may not show up in-game are under Flavor & story
hooks below. Hobart is currently the least developed of the three villages
and is the natural place to grow bookshop lots over time — reserve several
full-size open lots along Main Street per map rule 4, and let named shops
fill in gradually rather than all at once. **Cellar Door Wines** has a small
patio out front — really just a bench — so a scene set outside the shop
should be a bench, not a deck full of tables.

**Stewart's interior.** The clerk is enclosed behind the counter; the player
talks across it and cannot walk round.

## Open items — pending map work

New businesses/landmarks Tom has named that aren't placed on the map yet.
Don't guess coordinates for these; they need a real redraw pass of the village
concerned (reference imagery + critic rubric, per the map rules below) rather
than a notes-file guess:

- **Mountain Dog Cafe** is deliberately *not* named on the map yet. Its
  building is on Stamford's Main Street block, west of Tops, as an unnamed
  filler; naming it waits on Tom.

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

## Art policy

Code, maps, tools, and checks are built with AI help. The art that ships in
`worlds/route10/` — facades, characters, portraits — is painted by people;
no model-generated art goes in. AI can help a contributor behind the scenes
(turning a photo into a plan they paint themselves), and if it did, their
credit says so in their own words. Unpainted buildings stay placeholder
boxes until someone paints them — that's the invitation, not a gap.

## Flavor & story hooks

Fun, true things about the area to draw on for episodes and ambient
dialogue. These are raw material, not finished copy — run anything derived
from them through hard rules 5 and 6 (no real private people without
opt-in, everything warm and affectionate) before it reaches the player.

- **How Hobart became a book village — real origin story, strong episode
  material.** Hobart was a near-ghost town on Main Street when a couple
  opened an antiquarian bookshop around 2000, mostly to store their
  overflow books from a Manhattan apartment. A local who'd returned to the
  area (former concert pianist, ex-IBM, restored furniture in between)
  thought the idea was ridiculous — "the dumbest thing I'd ever heard, an
  antiquarian bookstore in a ghost village" — until someone brought up
  Hay-on-Wye, the real "town of books" in Wales that draws bibliophiles by
  the tens of thousands. He came around, opened two more shops himself in
  2005, and started renting out empty storefronts to other booksellers.
  That's a genuinely great small-town story: skepticism turning into a
  whole village's identity, on a bet, over a shared joke about a town in
  Wales. Strong candidate for an actual episode (told in flashback by a
  present-day character, or as an oral-history "how did this all start"
  conversation with a visitor. That distinction matters: **no
  anniversary/founding-date sign posted in the village itself** — a
  visible "20 years of Book Village!" placard would make Hobart read as
  newer to a visitor than it feels, which is the wrong direction. But
  spoken aloud, by a character, as a surprise reveal to a newcomer ("you
  know this was all empty storefronts, not that long ago?") is exactly the
  fun version of the same fact — fair game for dialogue and even a whole
  episode's premise. Sign vs. story, not silence vs. story. The real
  founder and the couple who opened the first shop are real, named people —
  per hard rule 5, any character built on this needs to be its own invented
  local (a fictional "town historian" or old-timer telling the story
  secondhand), not a stand-in for them, unless they opt in.
- **Hobart Festival of Women Writers.** Real annual event, founded 2013,
  three days of workshops and public readings held through the village's
  actual bookstores each June. Good calendar-reactive material (DESIGN.md
  §1) for a June episode — a village-wide happening rather than a
  single-building story, and a natural way to show off several bookshops
  at once without inventing shop names prematurely.
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
- **Mountain Dog Cafe and Stamford Coffee's shared origin story.** A true,
  delightful coincidence: Stamford had no coffee shop, then two opened
  the very same week — Mountain Dog Cafe (west of Tops) and Stamford
  Coffee — neither one knowing the other existed until it happened. For a
  while the town had a gentle, good-natured split: more of the longtime
  locals went to Mountain Dog, more of the city transplants and visitors
  went to Stamford Coffee. Not a real rivalry, just two good options and
  people had their habits. Mountain Dog is closed now. Handle the closure
  like Hillhaven Farms above — matter-of-fact and a little wistful. Extra
  care both directions: never frame it as "the local place lost" (a dig at
  Stamford Coffee, a real, currently open business) and never frame
  Mountain Dog's closure itself as a dig at Mountain Dog either — no
  implication it wasn't good enough, closed for a sad reason, etc. It
  simply closed; both places were loved. The real hook here isn't the
  rivalry, it's the coincidence itself: **how did two coffee shops open in
  a town this small, the same week, without either one knowing about the
  other — when everybody here knows everything else that's going on?**
  That's a genuinely fun small-town-density irony (the one time the town's
  gossip network somehow missed something) and probably the better beat to
  actually write, more than the "who went where" split. Good material for
  an old-timer telling it as a "you won't believe this" story.
- **Middle Brook Cafe's lot.** Dollar General had been eyeing that land
  before the cafe went in — locals are quietly glad DG ended up down the
  road to the east instead. Frame this warmly (relief that the cafe is
  there), never as a knock on the Dollar General itself, which is a real
  business a few doors down.
- **The unreachable contractor.** A very true, very relatable rural
  frustration: everyone's always looking for a contractor to fix up the
  house, and half of them just don't return calls — often because the
  good ones are simply swamped with work, not because they're flaky. A
  classic "help someone chase down a contractor" or "the contractor
  everyone swears by is booked till spring" episode premise, played as a
  shared, good-natured town frustration rather than a knock on anyone in
  particular. Real inspiration for *where* to find them: the deli counter
  inside the Jefferson gas station, across the road from Middle Brook
  Cafe — officially "J&H," but locally known by a nickname that's really
  the real owner's name, so per hard rule 5 don't use it. Give the
  in-world spot its own invented nickname instead (e.g. "Duffy's") rather
  than the real one. That's exactly where the contractors everyone's
  chasing actually have breakfast — a good "ask around town, get pointed
  to the gas station deli, and there they all are" beat for the episode.
- **The old-timer who fixes septic problems.** Real-world inspiration for
  a great character archetype: an old-timer, well past the age you'd
  expect to still be doing the work, who's the person everyone calls for
  septic trouble — and who tends to show up trailing an entourage of
  other local characters, so what should be a quick fix turns into a
  small social event. **This needs to be built as a fully invented
  character, not the real person** (hard rule 5 — Tom flagged this one
  himself as needing careful handling). Don't use the real name or
  identifying details beyond the archetype: old, a fixture of the towns,
  more showman than tradesman, brings a crowd. A good "help someone" or
  "witness an event" episode could turn a mundane errand (something's
  wrong with the septic) into a chance to meet three new characters at
  once, purely through his orbit.
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
- **T.P.'s Cafe / Ace Hardware / Railroad Ave.** A little corridor a block
  off Main — T.P.'s sits off Railroad Ave next to Ace Hardware, reached down
  Churchill Ave. Now on the map, and a good candidate for a "there's a whole
  street I hadn't noticed" discovery beat.
- **Veterans Memorial Park.** Different register from the rest of this
  list — a memorial, not a business or a gag. It is on the map now, a small
  green on the south side of Main between Solinsky's and Academy Street.
  Keep any copy quiet and respectful rather than cute; still warm, but the
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
- **The sunflower field.** Real inspiration: someone bought a piece of
  land and planted a whole field of sunflowers, for no reason other than
  delighting the neighbors. Pure, simple material — a field of flowers
  that exists purely to make people happy, no conflict needed, exactly the
  "just be delighted" register CLAUDE.md hard rule 6 is asking for. Good
  for a late-summer seasonal beat: a travel-card glimpse of the field from
  the road, an NPC who detours to walk past it, a "take one" jar left at
  the edge of the field. Build the owner as a fully invented local
  character (hard rule 5), not a stand-in for the real person, unless they
  opt in.
- **The flower farm and the zoning hearing.** Real inspiration: a couple
  bought land and started a flower farm; at the town hearing for approval,
  someone objected on zoning grounds even though Jefferson is explicitly
  right-to-farm, arguing that flowers aren't really a "crop" the way
  vegetables or hay are. The board overruled the objection and the farm
  went ahead. A genuinely good story of small-town process working the way
  it's supposed to — play it as "the system got it right," not as a
  grievance against anyone who spoke up. Per hard rule 5, both the farm's
  real owners and the real objector need to become fully invented
  characters, not stand-ins, unless they opt in. The comic engine is the
  argument itself ("are flowers a crop?") — good bored-clerk/town-hall
  material pairing with the Jefferson Town Hall note above, voiced by an
  invented skeptical neighbor and resolved warmly by an invented board
  member citing the real right-to-farm rule. Could turn out to be the same
  flower farm as the sunflower field above, or a separate one — worth
  settling when the episode actually gets plotted.
- **The beaver saga.** Real inspiration, great shape for a multi-day
  small-town saga, but it needs careful handling to land inside CLAUDE.md
  hard rule 6 (no combat, everything warm, the "would this reader smile"
  bar) — flagging that up front rather than writing it as told. A beaver
  moves into someone's pond and dams the outflow stream; the property (and
  the road) starts flooding. The owners call in a wildlife-removal guy who
  looks exactly the part — huge beard, waders, the works — but the beaver's
  back the next day. The town removes the dam instead, which promptly
  washes out a downhill neighbor's garden. Then a truck shows up, a couple
  of bangs are heard from the woods, and the beaver's simply not around
  anymore — "a drive-by shooting in the woods," as the story gets told
  after the fact. The escalating-chaos shape of this (flood → removal guy
  → dam pulled → neighbor's garden washes out → mystery resolution) is
  terrific small-town-saga material, several beats' worth, and worth
  keeping. The ending is the part that needs real care: **never depict the
  beaver being shot, or confirm on the page that it was killed.** The
  instinct to leave it open-ended is exactly right, and is the thing that
  makes this usable at all — lean all the way into "nobody in town
  actually knows what happened, and everyone tells it a little
  differently" pure-rumor-mill territory, rather than staging or narrating
  any violence toward the animal. The bang itself can stay ambiguous
  in-world too (a truck backfiring, someone's fireworks, actually
  unrelated) — the town not being sure is funnier and safer than the town
  being sure. Good material for a "get to the bottom of a local legend"
  episode structure: the player collects each person's version of the
  story (the flooded-out owners, the bearded wildlife guy, the
  downhill-garden neighbor, whoever heard the bangs) and the fun is in the
  contradictions, not a resolved answer. The wildlife-removal character
  (a fully invented local, hard rule 5, built from the "looks exactly like
  you'd expect" archetype rather than any real person) is a nice one-off
  or recurring cameo either way.
- **"Anybody Headed Down Today?" — built, unshipped, in
  `worlds/route10/episodes/ep002.json`.** Logline: a Jefferson kid is in a
  dance showcase in the city tonight and left half the costume on the
  kitchen table; find somebody driving down today who can take it. Real
  inspiration: the ask goes out the way these things actually go — word
  of mouth, a Facebook-group post, someone mentioning it at the counter.
  Spiced from the original "forgot their keys" version: a costume piece
  instead, lower-stakes and warmer, with a built-in reason it has to be
  today without needing an actual timer (the hard rules forbid those
  anyway). Not in `world.json`'s `episodes` list, so it doesn't ship; it
  validates with `npm run validate-episodes -- --all` (DESIGN.md §3's
  review path — the same way ep000 is kept around unshipped) and can be
  played directly with `?episode=ep002`.

  Went through a design pass before being written (an automated review on
  the PR that added this note caught real issues before any JSON
  existed — worth recording what changed and why, since the same
  mistakes are easy to re-make): **`EpisodeNpc` has no `requires` field
  (engine/schema.ts) — NPCs are on their tile from frame one and never
  arrive, leave, or vanish**, so "before the commuter leaves" can only
  ever be a line of dialogue, never a mechanic; a player who talks to
  everyone in any order will meet the commuter (Walt, at J&H) well before
  the reveal flag is set, so his pre-reveal line had to be written as a
  real, standalone piece of texture that plants the clue without winking,
  not a placeholder. The first draft also ran two flat "not me, try
  someone else" dead ends in a row (a fetch-quest smell) and closed with
  a return trip to Jefferson after the handoff already happened; the
  built version fixes both — Stamford (Hannah) redirects to Hobart and
  Tops's board; Hobart (Renata) is the one that actually cracks it with a
  concrete, NYC-commuter-flavored clue (a cooler bag from a city grocery
  run, not a Tops run) and names Walt; the handoff at J&H itself sets
  `done` and fires the completion toast, so the episode ends there —
  Priya's line for a player who walks back is a grace note, not a
  requirement, the same way ep001 ends at Nora rather than routing back
  through Earl. Also collapsed from six-plus flags and a separate
  item-pickup step down to four flags (`heardAsk`, `triedStamford`,
  `triedHobart`, `done`) and a dialogue-only handoff — Priya hands over
  the bag in conversation rather than the player fetching a physical
  item, which was one whole beat with nothing left to say. Register note:
  Priya reads as steady and out of options, not flustered, matching the
  composed-but-worried register ep001's Nora already sets rather than
  inventing a different one.

  The payoff line answers a design question worth recording on its own:
  the natural beat is "a photo of the kid in costume that evening," but
  the engine has no mechanism for showing an arbitrary photo in
  dialogue — only fixed per-NPC portraits and building facades, no
  generic image-in-a-line field in the sign/dialogue schema (DESIGN.md
  §3). Rather than build new image infrastructure for one line, it's
  played through text the way ep001 plays its own payoff: Priya describes
  getting the photo and jokes that the player will just have to imagine
  it, rather than the engine pretending to show one. An actual in-game
  photo mechanism (a generic "story image" asset type, distinct from
  portraits) would be a real feature worth scoping on its own if it ever
  comes up again, not something to fold into this episode.
- **The M&M fire and the fire-department open house epic.** Real
  inspiration, being scoped as a full epic (DESIGN.md §3a/§3b) rather than
  a single episode. The story, as told so far: the empty lot across from
  Stamford Coffee noted above once held Half Acre, a high-end restaurant
  four new-to-town locals opened together, with their own apartments
  upstairs. The year before Half Acre's own fire, they hosted a
  local-business fundraiser dinner — the whole town there — when a wave of
  pagers went off mid-meal: M&M's auto shop, further east than the current
  map runs, was on fire, and it was a big one. The volunteer firefighters
  in the room (see the fire-department note above) left mid-course; Half
  Acre sent burgers out to the crew working the blaze. Trucks had to relay
  water from a pond west of Route 10 (not currently on the map) all the
  way to the fire. The town turned out for M&M, which is rebuilt now and
  looking great. Some time later, Half Acre itself burned down, and the
  people living in the apartments above it lost their homes; the community
  helped, but it landed in the middle of an already-tight local housing
  market (see the second-homes/Airbnb note below, kept as a separate,
  later topic).

  Proposed shape: an **open house** framing (a real fire-department open
  house day, present-day) rather than a literal flashback the player plays
  through start to finish — the player experiences the M&M night as a
  vignette scene (DESIGN.md §3a) triggered by a narrating NPC, alongside
  real present-day tasks (help set up, walk the hose route to the newly
  mapped pond, deliver food, end at the rebuilt M&M — good fit for the
  task-checklist idea at DESIGN.md §3c). The volunteer-firefighter
  archetype from the note above is a natural narrator. Half Acre's own fire
  and the displaced tenants stay almost entirely off-screen in this
  episode — at most one warm, oblique line — with the empty-lot note above
  as the natural home for that story later, once there's a reason to tell
  it (a "what should go here" episode, DESIGN.md §3b's second chapter).

  Hard-rule-6 guardrails, restated for whoever picks this up: never depict
  either fire on-screen (the vignette schema's smoke-not-flames rule
  exists for this), never put the player or any NPC in on-screen danger,
  and land the whole thing on the town coming together, not on loss. At
  least two episodes' worth of material — the open house epic first, a
  Half-Acre-lot / housing-adjacent follow-up later and separately, with
  Tom's explicit sign-off before that second one gets written.
- **Second homes, Airbnb, and the housing crunch.** Real and current
  tension worth facing eventually, not avoiding — people from the city
  buying up houses as vacation homes or short-term rentals is a genuine
  point of contention locally, and pretending Route 10 has no housing
  pressure would ring false. But this is the one topic on this list where
  "handle with care" isn't enough on its own: it has real people on both
  sides who might play this game (locals priced out, and second-home
  owners who love these towns too), so it needs Tom's explicit sign-off on
  tone and scope before any copy gets written, not just the usual
  hard-rule-6 pass. If it's ever taken on, the shape to aim for is "the
  town facing a real problem together," closer to the flower-farm-hearing
  note above (the system/community working through something hard) than a
  grievance narrative — and never framed as a swipe at anyone who owns a
  second home here. Parked for now; flagged so it isn't forgotten. Came up
  alongside the Stamford fire-department-open-house epic (see DESIGN.md
  §3a) as a candidate for a later, separate episode — not bundled into
  that one.
