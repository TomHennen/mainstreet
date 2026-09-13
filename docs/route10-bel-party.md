# The party at the Bel — story treatment

A treatment, not an episode: nothing here is built. It answers Tom's ask
(Sep 2026): a storyline whose payoff is a party at the Belvedere, using the
lighting and scene mechanics that already exist, with real music if we can
get it freely, with a trip round the second-hand shops for an outfit, and a
bit more edge than the episodes so far.

Revised three times on Tom's notes. First: the party is inside the Bel on
the stage; the bar is open and quiet by day and the party is at night once
the errands are done; the yard is a chill hang; "honey wagon" is the word;
real music over chiptune, source credited. Second: the space under
Stamford Coffee is a record and vintage shop; a couple who love thrifting
are in both shops at once. Third: the outfit is assembled across both
shops, with leads out of town that do and don't pan out; the word is a
puzzle the player solves rather than a flag they are handed; at the door
the player *chooses* a word, and getting it wrong means singing your way in
(Tom: think of the Safe House in Milwaukee); and the engine's own
placeholder figure should be able to draw these people's clothes, since
nobody is painting sprites by hand yet — **built**, see "Drawing these
people" below. Written to `docs/writing-episodes.md`: no arrows, the first stop
tells the truth without pointing, jokes are situations, every line opens
by naming what it answers.

Everything below runs through CLAUDE.md hard rules 5 and 6 before it reaches
a player: real businesses by name with affection only, invented people
everywhere else, every line warm. "Edgier" here means more night, more
friction, more of the Bel's own cheek — never a line at anyone's expense.

## What we already have

- **The Bel, inside and out**, built to Tom's two walk-throughs: the narrow
  front room with a **stage across the top of it**, the peninsula bar with
  Marnie inside it, the blackboard wall, the papered wall with the dry pool
  behind it, foosball, the hallway with the sharpie wall and the two
  bathrooms (one closed until further notice), and the yard with the
  firepit and the woodpile you can take a log off.
- **Scenes and lighting** (DESIGN.md §3): `party` mode with drifting
  coloured discs over any tiles we name (the stage), `dim` for evening
  outdoors, `glow` on the fire, a camera that can follow a person, NPCs
  walking in, overlays. `demo-party.json` is a working version of "the
  lights come up". The lights drift and breathe; there is no strobe, by
  Tom's earlier call.
- **Items and the With-you panel**: each piece of the outfit is a
  carried-only episode item handed over in dialogue and carried until a
  flag closes it out.
- **The stairwell under Stamford Coffee.** ep002 paints it as an overlay on
  the deck at `[91, 25]` — plywood, paper on the window, a saw going. Three
  ep002 characters each have a confident wrong guess about what it is.
- **Marnie** is the bar's permanent person; the episode takes her over by
  id. **Renata** at Cellar Door and **Dot** outside Middle Brook Cafe are
  ep001's, and can come back for a week.
- **Real facts to lean on.** The Bel calls itself a speakeasy-style dive bar
  and is the last building operating from the hotel era when Stamford was
  the Queen of the Catskills; DJ nights and the occasional scrappy punk
  band are what plays there. Core Values is a real thrift workshop at 112
  Main Street, thirty-odd years old. Tom's word: the shop going in under
  Stamford Coffee is a record and vintage shop. The "honey wagon" is what
  the septic truck is called around here (notes). Notes in
  `docs/route10-notes.md`.

## The pitch

**Working title: "What's the Word."** Alternatives: "Saturday. You Know.",
"Honey Wagon", "Sing Your Way In".

**Logline.** The Bel is doing a speakeasy night. No flyers; the board out
front says only SATURDAY. YOU KNOW. — and you don't. Marnie's rule: you
give the word at the door, and you don't come in what you wore to work.
The outfit takes both of Stamford's second-hand shops and, if you want to
do it properly, a drive. The word is going round town badly. And if you
get it wrong at the door, there's a house rule for that.

**Why this one.** It takes what the notes already say about the Bel —
spookiest building in Stamford, warmest room in it, calls itself a
speakeasy — and makes it the mechanic. The two shops have a real job. The
record shop's opening pays off ep002's rumour mill without anybody
announcing it. The comedy is small-town density: everyone knows
everything, so a password can't be kept and nobody remembers which one is
current, and the same couple is in every shop you walk into. The door is
the one place the game asks the player to commit to what they've worked
out, and both answers are a good time. The heart is a newcomer who won't
go up the hill until the player, by then a local, walks her in.

## Two errands and a puzzle

The episode is held shut by the world, not by anybody stonewalling:

- **The outfit is an errand.** Two pieces, one from each shop, plus an
  optional flourish from out of town. Flags.
- **The word is a puzzle.** Nobody hands it to the player as a flag. Marnie
  will tell anyone who asks her; the wall has it drawn on it; Earl has last
  year's and is sure. At the door the player *picks* from a list, and the
  list is not gated by anything. What they know is the test.
- **The door is the test**, and there is no failing it. Right word: in,
  with a laugh. Wrong word: you sing your way in, and the room helps.

## Day and night

One flag, `partyOn`, lands when the player has both required pieces of the
outfit. Before it, Stamford is in ordinary light and the Bel is open and
nearly empty, three-in-the-afternoon empty: Marnie, Gus alone at the
foosball, Wren on the stage running cables. After it, Stamford goes to
`dim` and stays there, and the Bel fills — DJ on the stage under the
lights, a crowd, Gus just inside the door — and the yard is the chill hang
by the fire with the music at half volume through the wall. No timer.

## Cast

Invented, all of them. Names go through Tom's check (notes, "People").

- **Earl** — outside Stewart's. Knows everything, half of it current.
- **Marnie** — the Bel. Gives the word to anyone who asks. Nobody asks.
- **Gus** — by day at the foosball; by night on the door.
- **Wren** — the DJ. By day running cables on the empty stage.
- **Thea, Vera** — the party, as in the demo.
- **Linnea** — new to town, at the foot of Academy Street, not going up.
- **Teo and Birdie** — a couple who love a second-hand shop, in Core
  Values and the record shop and, at night, the Bel. Teo: medium black
  hair, black shorts, black sleeveless shirt. Birdie: longer blond hair, a
  colourful outfit. Both drawn by the engine from a `look` (below), no
  painting needed. They know where every good piece of clothing in the
  county is. Real inspiration, so invented characters; if the looks make
  them recognisably the real pair, that is the get-pixelated-into-Route-10
  opt-in and Tom's to ask.
- **Renata** — Cellar Door Wines, Hobart, back for a week. Wore a velvet
  bow tie to the record shop's opening.
- **Dot** — Jefferson, back for a week, wearing her own hat.
- **The Core Values volunteer** and **whoever is unpacking boxes in the
  record shop** — real counters, unnamed until Tom names them.

## Beats

1. **Hook.** Intro: "The board outside the Bel says SATURDAY. YOU KNOW.
   You don't. Earl, out front of Stewart's, probably does." The chalkboard
   overlay reads the same. Small talk, ten lines or more, is the town not
   quite keeping it: "Saturday? I'm not supposed to say.", "I went up last
   year in my work boots and Gus made me take them off and dance in my
   socks.", "The paper's off that window under the coffee shop. Records, of
   all things.", "The honey wagon was up our road this morning. Whole
   street came out to watch." That last one is not a wink; it's the town
   talking about a septic truck, and it's a clue.

2. **Earl tells the truth and points nowhere.** "The Bel? Saturday's a
   speakeasy night. Marnie's rule: the word at the door, and you don't
   come in what you wore to work." Lower: "The word's *lantern*. You didn't
   get it from me." Sets `heardAsk`. He names no shop. The player looks at
   Main Street: a thrift shop that's been there thirty years, and a shop
   that just opened with records in the window.

3. **The Bel by day.** Anyone can walk in. Marnie, asked: "The word? Honey
   wagon. Don't write it on the wall — that's how last year's got out."
   (She's wrong about that; see the wall.) Wren: "Sound check. Come back
   when it's dark." Gus: "Quiet in here? It's three in the afternoon."
   **The sharpie wall** has a new line in its copy this week: "Fresh among
   the drawings, in a careful hand: a truck with a big tank on the back, a
   hose off the side, and under it, THIS YEAR." A player who has heard the
   town talk about the honey wagon has the word without asking anyone.

4. **Core Values.** North side of Main. The volunteer: "Something for
   Saturday? That rack by the door — half of Stamford's been through it.
   Take what fits, bring it back Monday, or don't." Hands over **a deep
   green velvet blazer** (`hasJacket`). Teo and Birdie are at the rack.
   With the blazer already on you, from the record shop's side: nothing
   more to hand over, but see Teo and Birdie.

5. **The record shop under Stamford Coffee.** The overlay changes: paper
   off, plywood gone, the stairwell open. Down it, a new room: LP crates, a
   rail of old jackets and shirts, album covers going up, no sign — "the
   sign's on order" — and somebody unpacking boxes who says the clothes are
   for sale too. Hands over **a bowling shirt with somebody else's name
   stitched over the pocket: RAY** (`hasShirt`). Teo and Birdie are at the
   rail. Fern, Ozzie or Ines, if they're about, get one line each at most
   on the answer ("Records. I said gallery. There are album covers on the
   wall, so I'm counting it."). Twice is texture.

6. **Teo and Birdie, once.** Met first in either shop (`metTB`); in the
   other: "Oh — hello again. We do get around." That is the joke, said
   once, by them. With one piece on you, in the second shop, they are the
   people who know where the rest is, because that is who they are: "That
   blazer wants something at the neck. Renata at Cellar Door wore a velvet
   bow tie to the opening down here, and there's been a very good hat on
   the hook at Mill Pond Inn since pizza night." Two leads, one of them
   good. At the Bel that night they say nothing about any of it.

7. **Out of town, optional.** Uses all three villages.
   - **Cellar Door Wines, Hobart — works.** Renata: "The bow tie? It had
     its night. Take it." (`hasTie`.) The flourish shows up only in what
     people say to you later; nothing is gated on it.
   - **Mill Pond Inn, Jefferson — doesn't.** The hook by the door: a dog
     lead, a scarf nobody's claimed, and a note in pen: "Took my hat back.
     D." Dot, outside Middle Brook Cafe, is wearing it: "My hat? It sat on
     that hook a month before I remembered. You'll do fine without." A
     dud with a smile, and the trip is the point.

8. **Linnea at the bottom of the hill.** By day: "That building? Is that
   really where everyone's going? It looks like it's leaning." Once
   `partyOn`: "You've been in? And it's alright?" — and she walks up behind
   you when you go.

9. **Night falls.** `partyOn` lands with the second required piece
   (whichever it is). Toast "The light's going off the hills." and `dim`
   on Stamford, kept. Whoever hands over the second piece says to come back
   after dark, so the player leaves and walks up Academy Street in the
   evening.

10. **The door.** Entering the Bel with `partyOn`, Gus is inside the door.
    "What's the word?" — and the player is asked to pick:

    > Lantern · Honey wagon · Utsayantha · I don't have it

    Nothing gates the list. Then:
    - **Honey wagon.** "Honey wagon? Nobody's said honey wagon all night.
      Who gave you that? ... Marnie? She doesn't tell *anyone*. — She did?
      Well. You're alright, then. Evening, Ray." Sets `saidWord`. Lights
      up over the stage, music, the camera follows Wren onto the stage
      and hands back, Linnea comes in behind. `letIn`.
    - **Lantern.** "Lantern. Last year's. Earl? Thought so." Beat. "House
      rule, then." Sets `sangIn`. Scene: the player is walked up the room
      and onto the stage, the discs come up over them, the music drops for
      a bar, and the narrator: "You don't know the words. It turns out that
      doesn't matter — the room does." One line from the crowd, the music
      comes back up, the player is walked down off the stage. `letIn`.
      Everyone who came in on "lantern" tonight did this. It is not a
      forfeit; it is the better entrance, and some players will pick it on
      purpose.
    - **Utsayantha.** "Utsayantha. That's the mountain. Good guess. House
      rule." Same scene.
    - **I don't have it.** "Nobody does, first time. House rule." Same
      scene.

11. **The party.** Free roam, nothing required:
    - **The stage.** Wren on it, the discs drifting, the crowd facing it.
      Real music, the whole room's worth. If it earns its place: "This
      crate? Half of it came up those stairs under the coffee shop."
    - **The bar.** Marnie: "Told you. Nobody asks." With `sangIn`: "You
      sang? Good. Better than the word, honestly."
    - **Foosball**, a grudge match running since March.
    - **Thea** trying to get somebody up between sets. With `sangIn`: "You
      again? You've had your turn."
    - **The one working bathroom**, a small queue that chats (Tom's
      exception (b)). Somebody in it: "Lantern gets you the *other* door."
    - **The wall.** Every hand in town, and the truck with the tank.
    - **Ray.** At most twice, somebody calls you Ray. Gus at the door and
      one person in the yard. Not a third time.
    - **The yard.** Out the hallway door the music drops to half through
      the wall: the fire, the stools, the woodpile, three people out for
      air. Put a log on the fire (`glow`, built). "Do you smell a skunk?" —
      "Every night about this time. It's the Catskills." Linnea is out
      here already, talking to two people.

12. **Ending.** Tom's pick, below.

## How the player figures out the word

Three roads, and the player can take any or none:

1. **Ask the person whose rule it is.** Earl says "Marnie's rule". Marnie
   tells anyone who asks. The trick is only that the town has convinced
   itself it's a secret.
2. **Read the wall.** The truck with the tank and THIS YEAR. It means
   nothing until the player has heard what a honey wagon is, and the town
   says so in small talk, as ordinary news about a septic truck. Two pieces
   of texture across town that click.
3. **Trust Earl.** Sincere, certain, last year's. The trap for anyone who
   takes the first thing they hear — and it leads to the stage, so it's a
   trap with a prize in it.

None of these sets a flag the door checks. The list at the door is the
same for everyone; the player's knowledge is what differs.

## Endings

Options; two or three stack, and exactly one sets `done`.

- **A. The wall.** Marnie comes out from behind the bar — the one time in
  the pack she isn't "right here" — and hands the player a sharpie: "Wall's
  that way. Everybody's on it." `done`. An overlay adds a line to the
  hallway panel for the rest of the week: "and, newest of all, whatever you
  just put there."
- **B. Out by the fire.** The episode closes in the yard: the log goes on,
  the music through the wall, the skunk line, and Gus, off the door at
  last, on the next stool: "You're alright, you know, Ray."
- **C. Next year's word.** Marnie's last line: "Since you asked — next
  year's is *equanimity*. Don't tell Earl." A callback waiting for the
  roadside sign.
- **D. The morning after.** A second `enter: stamford` after `done`: plain
  light, Gus sweeping the walk, the board by overlay: THANKS, EVERYBODY.
  NEXT ONE WHEN YOU LEAST EXPECT IT.
- **E. A corner of the paper.** One prop line at the papered wall during
  the party: "Somebody's peeled a corner back. Behind the glass, the old
  pool's tiles catch the lights." A free tease for a later pool episode,
  once the Bel has been asked.
- **F. Somebody sings.** Thea gets somebody up between sets and it is
  Linnea, and the room does the last line for her. (If the player sang
  their way in, this rhymes; if not, it's the newcomer's turn.)

Recommendation: B as the setting, A to set `done`, C as Marnie's last
line, D and E as cheap extras.

## The edgier menu

| Beat | Edge | Rule-6 read |
| --- | --- | --- |
| Gus on the door, and a word you have to pick | A bouncer; a test you can get wrong | Fine: nobody is turned away, and the wrong answer is the better party. |
| Earl's wrong word; the right word is suspicious | A town that can't keep a secret | Fine: the joke is on the town; Earl gives it out of generosity. |
| Singing your way in | Public, a little mortifying | Fine because the room carries you; the narrator never says you were bad. |
| A dress code, two shops and a drive | The errand has teeth; one lead is a dud | Fine if the shops are the help and the dud lead ends on Dot's smile. |
| A shirt that says RAY | You are Ray tonight | Fine: twice, fondly, never a third time. |
| The dark walk up Academy Street | Night, the leaning building | Fine: the notes' own spooky-outside, lovely-inside gag. |
| "Do you smell a skunk?" | Reads two ways | Tom's call, explicitly. Also literally true. |
| The sharpie wall | Already mentions penises | Tom-approved; don't escalate. |
| Real music, loud, on a stage | A DJ set | Fine. Never a fiddle. |
| The bathroom queue | The out-of-order door | Tom's exception (b). A queue that chats. |
| Drinks | It is a bar | "Something in a glass"; nobody is drunk, nobody drives. |
| Teo and Birdie everywhere | Mild uncanniness | Fine: said once, by them. |

Not on the menu: anything about the real Belvedere's condition beyond
"looks spooky, is lovely"; any real private person; the honey wagon joke
pointed at anybody's plumbing; any guess at the record shop's real name.

## Music

Tom's call: real music over chiptune, freely available, source credited.
Engine proposal in DESIGN.md §3d.

- **Best: real local music, opted in.** A track or a short mix from
  someone who actually plays the Bel, under CC BY 4.0 or their own written
  grant recorded in `credits.json`, credited in-game like a painting:
  "Music at the Bel this week by ___." The record shop opening the same
  week is the natural conversation to have with both.
- **Meanwhile: freely licensed real recordings.** Free Music Archive
  filtered to CC BY / CC0; the Internet Archive's netlabels; Kevin
  MacLeod's produced catalogue (incompetech.com, CC BY 4.0). Picking exact
  tracks needs a browser with access to those sites; three candidates, Tom
  listens and picks.
- **Cues.** Loud over the stage; the same track at half volume in the
  yard; dropped for a bar under the singing scene and back up after.
- **Licence rule.** CC0, CC BY 4.0, or a direct grant. ShareAlike and
  NonCommercial are out. Credit: title, artist, source link, licence.
- **Human-made only**, the same rule as art. Tom's call to write it into
  CONTRIBUTING.

## Drawing these people

Tom's point: nobody is painting sprites by hand yet, so the engine has to be
able to draw Teo's black shorts and sleeveless shirt itself. **Built, on this
branch** (`engine/figure.ts`, `engine/schema.ts`, `engine/validate.ts`,
DESIGN.md §4): a `look` now also takes `legs` (trouser, shorts or skirt
colour), `bottoms` (`trousers`, `shorts`, `skirt`), `sleeves` (`long`,
`short`, `none`) and `pattern` (`plain`, `stripes`, `dots`) in a second
colour `shirt2`. Every field is optional and the defaults draw exactly the
townsperson there has always been. The validator knows the new words and
refuses ones it can't draw.

```jsonc
{ "id": "teo-cv", "name": "Teo", "map": "core-values-interior", "pos": [4, 6],
  "look": { "hair": "short", "hairColor": "#111111", "shirt": "#1a1a1a",
            "sleeves": "none", "bottoms": "shorts", "legs": "#1a1a1a" } }

{ "id": "birdie-cv", "name": "Birdie", "map": "core-values-interior", "pos": [5, 6],
  "look": { "hair": "long", "hairColor": "#e8c86a", "build": "slim",
            "shirt": "#d9a441", "shirt2": "#4a7f96", "pattern": "stripes",
            "bottoms": "skirt", "legs": "#b5542a" } }
```

A painted `assets/chars/<id>.png` still replaces the whole figure if anyone
ever wants to; and a small `sprite` field (DESIGN.md §3e) would let the
three Teo entries share one painting when that day comes.

## Engine: what exists, what is needed

| Beat | Mechanism | Status |
| --- | --- | --- |
| SATURDAY. YOU KNOW. board | overlay with a prop, `requires: []` | exists |
| The town almost saying it; the honey-wagon slip | `smallTalk` | exists |
| The cast, day and night lines | episode `npcs`, first-match dialogue | exists |
| **Empty by day, full by night** | NPC `requires`, the mirror of `until` | **proposed**, DESIGN.md §3e; reverses §3's "no opposite of `until`". |
| Teo and Birdie in both shops and at the Bel | three entries each, same name and look | exists; a shared `sprite` field (§3e) means one painting |
| Two pieces, one per shop; the tie | three carried-only items handed in dialogue | exists |
| Wearing it on the sprite | `wardrobe` | **proposed**, §3e; fallback is the With-you panel |
| The wall's new drawing | this episode's overlay prop on the hallway panel | exists (check an overlay prop can sit on a room-spec panel tile; else the tile beside) |
| The stairwell opens | this episode's overlay on `[91, 25]` with an open-stairs tile | exists, once there is an open variant of the `stairs` tile |
| The record shop room; Core Values on the map and its room | new rooms and building entries | **content and map work**; the stairwell tile needs to become a real way in (a building/exit entry, since overlays can't add exits) |
| Night falls when the second piece lands | one `on: { flag }` scene per piece, each `requires` the other, both setting `partyOn` | exists **if** a flag-triggered scene honours `requires` as an enter scene does; verify, else a one-line validator/engine change |
| **The pick at the door** | `choices` on a dialogue entry | **proposed**, DESIGN.md §3f — the first `choice` node, listed as future in §3 since v1. Each choice has its own lines and effects; the branches set `saidWord` or `sangIn`, and `on: { flag }` scenes do the rest. |
| The singing scene | `move` the player onto the stage, `light: party` over them, `music` volume down and up, narrator `say`, `move` back | exists, once `music` does (§3d) |
| The lights, the DJ, Linnea in behind | `light: party`, `camera: npc:wren`, `move`, `set` | exists |
| Music, loud then through a wall | `music` step with `volume` | **proposed**, §3d |
| Log on the fire | carry verbs + `glow` | exists |
| Teo's shorts and sleeveless shirt, Birdie's stripes and skirt | `look.bottoms`, `sleeves`, `legs`, `pattern`, `shirt2` | **built** on this branch (`engine/figure.ts`) |

Flags, first draft: `heardAsk`, `hasJacket`, `hasShirt`, `hasTie`,
`metTB`, `partyOn`, `saidWord`, `sangIn`, `letIn`, `done`. Ten.

## Decisions (Tom, Sep 13 2026)

Asked one at a time; these are settled.

1. **Ending: out by the fire.** The episode closes in the yard — the log
   goes on, the music through the wall, the skunk line — and Gus, off the
   door at last, on the next stool: "You're alright, you know, Ray." His
   line sets `done`. The other endings (the wall, next year's word, the
   morning after, the corner of the paper, somebody sings) are not in.
2. **The door: four options.** Lantern, Honey wagon, Utsayantha, "I don't
   have it". Nothing gated. Anything but honey wagon means singing your
   way in.
3. **Out of town: both leads.** Renata's bow tie at Cellar Door works; the
   hat at Mill Pond Inn is gone and Dot is wearing it.
4. **The outfit shows on the player** — `wardrobe` (DESIGN.md §3e) is to
   be built, using the clothes fields the figure now draws.
5. **Music: a licensed real recording**, CC BY or CC0, credited with title,
   artist, source and licence. No local contribution pursued for now.
6. **Lights: the drifting discs as built.** No pulse, no flash.
7. **NPC `requires` is in** — the mirror of `until`, reversing §3's
   "no opposite" note. Day-Gus and night-Gus are two entries.
8. **Teo and Birdie** keep their names and need no opt-in: two people who
   like thrifting is an archetype, not a portrait.
9. **The counters get names, Tom checks them** against the real staff
   before anything ships. Proposed: **Oda** at Core Values, **Bram**
   unpacking boxes in the record shop.
10. **Real shops: proceed.** Core Values by name; the record shop is "the
    record shop under Stamford Coffee" with the sign on order until it has
    a name. Friendly heads-up to both before launch, Tom's.

## What to build, in order

Engine, each its own small PR: NPC `requires` (§3e); `wardrobe` (§3e);
`music` step with `volume` and the credits check (§3d); `choices` on a
dialogue entry (§3f). Content: Core Values on the map and its room; the
record shop room and the stairwell as a real way in; an open-stairs tile;
then the episode itself, reviewed on a printed script per
`docs/writing-episodes.md`. Music: three candidate tracks for Tom to pick
from.
