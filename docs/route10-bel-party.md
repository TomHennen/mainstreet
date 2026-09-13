# The party at the Bel — story treatment

A treatment, not an episode: nothing here is built. It answers Tom's ask
(Sep 2026): a storyline whose payoff is a party at the Belvedere, using the
lighting and scene mechanics that already exist, with real music if we can
get it freely, with a trip round Stamford's second-hand shops for an
outfit, and a bit more edge than the episodes so far.

Revised twice. After Tom's first read: the party is inside the Bel on the
stage; the bar is open and quiet by day and the party is at night once the
errands are done; the yard is a chill hang; "honey wagon" is the word;
Linnea stays; real music over chiptune, source credited. After the second:
the space under Stamford Coffee is a record and vintage shop, a second place
to find something to wear; and a couple who love thrifting are in both
shops at once, which is the joke and is remarked on exactly once. This
draft also follows `docs/writing-episodes.md`, which landed in between: no
arrows, the first stop tells the truth without pointing, jokes are
situations, every line opens by naming what it answers.

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
  walking in, overlays. `demo-party.json` is a working eight-step version
  of "the lights come up" with a cast of four (Vera, Wren the DJ, Gus,
  Thea). The lights drift and breathe; there is no strobe, by Tom's earlier
  call — a flash for this room would be Tom reversing that, and a small
  change in `engine/lighting.ts`.
- **Items and the With-you panel**: an outfit is a carried-only episode item
  handed over in dialogue and carried until a flag closes it out.
- **The stairwell under Stamford Coffee.** ep002 paints it as an overlay on
  the deck at `[91, 25]` — plywood over the bottom step, paper on the
  window, a saw going. Three ep002 characters each have a confident wrong
  guess about what it is.
- **Marnie** is the bar's permanent person; the episode takes her over by
  id and gives her the week's lines.
- **Real facts to lean on.** The Bel calls itself a speakeasy-style dive bar
  (its own public description), it is the last building still operating
  from the hotel era when Stamford was the Queen of the Catskills, DJ nights
  and the occasional scrappy punk band are what plays there. Core Values is
  a real thrift workshop at 112 Main Street — thirty-odd years old,
  clothes and housewares and books, run on the idea of people helping each
  other by sharing and salvaging. And Tom's word, Sep 2026: the shop going
  in under Stamford Coffee is a record and vintage shop. (Notes in
  `docs/route10-notes.md`.)

## The pitch

**Working title: "What's the Word."** Alternatives: "Saturday. You Know.",
"Honey Wagon".

**Logline.** The Bel is doing a speakeasy night. There are no flyers; the
board out front says only SATURDAY. YOU KNOW. — and you don't. Two things
get you in the door after dark: the word, and not turning up in what you
wore to work. Stamford has two places to find something better, a thrift
shop that has been there thirty years and a record shop that opened this
week, and the same two people are in both of them.

**Why this one.** It takes the two things the notes already flag about the
Bel — it looks like the spookiest building in Stamford and is the warmest
room in it, and it calls itself a speakeasy — and makes them the mechanic.
The two second-hand shops have a real reason to be in the story, and the
record shop's opening pays off ep002's rumour mill without anybody
announcing it. The comedy is the small-town-density irony from the notes:
everyone knows everything, so a password is impossible to keep and nobody
can remember which one is current — and the same couple is somehow in
every shop you walk into. The heart is the notes' "first time visiting"
beat turned round: the player arrives as the outsider and ends the week as
the one who talks a nervous newcomer through the sus door.

## Day and night

The episode has two halves on the same maps, switched by one flag,
`partyOn`, that lands the moment the player has both the word and an
outfit.

**By day** Stamford is in ordinary light and the Bel is open and nearly
empty, the way a bar is at three in the afternoon: Marnie behind the bar,
Gus alone at the foosball, Wren up on the stage running cables. Nobody
else.

**By night** — the moment `partyOn` lands — Stamford goes to `dim` and
stays there, and the Bel fills: the DJ on the stage with the lights over
it, a crowd at the bar and the tables, Gus just inside the door asking for
the word, Thea and Vera and a dozen townspeople, Teo and Birdie of course,
Linnea coming in behind you. The yard is the chill hang: the fire, the
stools, three people talking quietly, the music coming through the wall at
half volume.

There is no timer. Night is what happens when you've done the things.

## Cast

Invented, all of them. Names go through Tom's check (notes, "People").

- **Earl** — outside Stewart's, as ever. Knows everything, half of it
  current.
- **Marnie** — the Bel. Gives the word to anyone who asks. Nobody asks.
- **Gus** — by day alone at the foosball; by night on the door.
- **Wren** — the DJ. By day running cables on the empty stage.
- **Thea, Vera** — the party, as in the demo.
- **Linnea** — new to town, at the foot of Academy Street, not going up.
- **Teo and Birdie** — a couple who love a second-hand shop. Teo: medium
  black hair, black shorts, black sleeveless shirt (placeholder: `hair:
  "short"`, black `hairColor`, black `shirt`; the shorts and the sleeves
  are for whoever paints the sprite). Birdie: longer blond hair, a
  colourful outfit (placeholder: `hair: "long"`, blond `hairColor`, a warm
  bright `shirt`). They are in Core Values, and they are in the record
  shop, and at night they are at the Bel. If they are recognisably a real
  pair, that is the "get pixelated into Route 10" opt-in and Tom's to ask.
- **The Core Values volunteer** and **whoever is unpacking boxes in the
  record shop** — real counters, so unnamed until Tom names them.

## Beats

1. **Hook.** Intro: "The board outside the Bel says SATURDAY. YOU KNOW.
   You don't. Earl, out front of Stewart's, probably does." The chalkboard
   overlay reads the same. Small talk (ten lines or more, for the
   validator) is the town almost saying it: "Saturday? I'm not supposed to
   say.", "I went up last year in my work boots and Gus made me take them
   off and dance in my socks.", "The paper's off that window under the
   coffee shop. Records, of all things.", "Everybody's got the word except
   the one person who gives it out — no, hang on, that's backwards."

2. **Earl tells the truth and points nowhere.** "The Bel? Saturday's a
   speakeasy night. Marnie's rule: the word at the door, and you don't
   come in what you wore to work." Then, lower: "The word's *lantern*. You
   didn't get it from me." Sets `heardAsk`, `earlsWord`. He does not say
   where to find a jacket. The player looks at Main Street and works it
   out: a thrift shop that's been there thirty years, and a shop that just
   opened with records in the window.

3. **The Bel by day.** Marnie, first ask: "The word? Honey wagon. Don't
   write it on the wall, that's how last year's got out." Sets `gotWord`.
   With `earlsWord` first: "Lantern? That's last year's. Earl hands out
   last year's every year. It's honey wagon now." Wren, on the stage:
   "Sound check. Come back when it's dark." Gus, at the foosball: "Quiet
   in here? It's three in the afternoon."

4. **Core Values.** North side of Main. The volunteer: "Something for
   Saturday? That rack by the door — half of Stamford's been through it.
   Take what fits, bring it back Monday if you like, or don't." Hands over
   **a deep green velvet blazer** (carried-only item, `hasOutfit`). Teo
   and Birdie are at the rack. Copy about the shop is what it is: thirty
   years of people bringing things in and taking things out, a book you
   didn't know you wanted. Nothing about price, condition or clutter.

5. **The record shop under Stamford Coffee.** The overlay changes: paper
   off the window, plywood gone, the stairwell open. Down it, a new room:
   crates of LPs, a rail of old jackets, album covers going up on the wall,
   no sign yet — "the sign's on order" — and somebody unpacking boxes who
   says the jackets are for sale too. Hands over **a corduroy jacket with
   somebody else's initials in the collar** (`hasOutfit`). Teo and Birdie
   are at the rail. Fern, Ozzie or Ines, if they are about, get one line
   each at most reacting to the answer ("Records. I said gallery. There are
   album covers on the wall, so I'm counting it.") — twice is texture.

   Either shop gives an outfit; the other, visited second, has something
   to say about the one you're wearing instead of handing over a second
   one (first-match: the `hasOutfit` entry comes first).

6. **Teo and Birdie, once.** The player meets them in whichever shop comes
   first (`metTB`); in the other shop they say: "Oh — hello again. We do
   get around." That is the joke, said once, by the people it belongs to.
   Nobody else mentions it. Their other lines are about what's on the rail
   and who owned it. With `hasOutfit`, in the second shop: "That blazer?
   We saw it Tuesday and left it for somebody. Glad it was you." At the
   Bel that night they are there too, and say nothing about it.

7. **Linnea at the bottom of the hill.** By day: "That building? Is that
   really where everyone's going? It looks like it's leaning." With the
   word and an outfit: "You've been in? And it's alright?" — and she walks
   up behind you when you go. The notes' first-time-visitor beat with the
   roles swapped.

8. **Night falls.** Whichever of the word and the outfit comes second sets
   `partyOn` (two dialogue variants, first-match ordered). A scene on that
   flag: toast "The light's going off the hills." and `dim` on Stamford,
   kept. Whoever hands over the second thing says to come back after dark,
   so the player leaves and walks up Academy Street in the evening.

9. **The door.** Entering the Bel with `partyOn` runs the party scene. Gus
   inside the door: "What's the word?" — and the right word is the
   suspicious one: "Honey wagon? Nobody's said honey wagon all night. Who
   gave you that? ... Marnie? Marnie doesn't tell *anyone*. — She did?
   Well. You're alright, then." Then, to the next person in behind you:
   "Lantern. Yep. Earl. In you go." The lights come up over the stage, the
   music starts, the camera follows Wren up onto the stage and hands back,
   Linnea comes in. Sets `letIn`.

10. **The party.** Free roam, nothing required:
    - **The stage.** Wren on it, the discs drifting over it, the crowd
      facing it. Real music, the whole room's worth. One line from Wren,
      if it earns its place: "This crate? Half of it came up those stairs
      under the coffee shop this afternoon."
    - **The bar.** Marnie, run off her feet: "Told you. Nobody asks."
    - **Foosball**, a grudge match that has been running since March.
    - **Thea** trying to get somebody up to sing between sets.
    - **The one working bathroom**, a small queue that chats (Tom's
      exception (b)). Somebody in it: "Lantern gets you the *other* door."
    - **The wall.** Every hand in town.
    - **The yard.** Out the hallway door the music drops to half through
      the wall, and it is the fire, the stools, the woodpile and three
      people who came out for air. Put a log on the fire (`glow`, built).
      "Do you smell a skunk?" — "Every night about this time. It's the
      Catskills." Linnea is out here already, talking to two people.

11. **Ending.** Tom's pick, below.

## The wrong word

Three places it's funny, all first-match dialogue:

- **Marnie, by day**, when the player brings her "lantern": last year's;
  Earl hands out last year's every year. Then the real one.
- **Gus, at the door**: the right word is the suspicious one, and the
  lantern crowd gets in anyway. The password fails as a secret and
  succeeds as a party.
- **The bathroom queue**: "Lantern gets you the other door."

Never at Earl's expense: he gives it away because he wants you there.

## Endings

Options; two or three stack, and exactly one sets `done`.

- **A. The wall.** Marnie comes out from behind the bar — the one time in
  the pack she isn't "right here" — and hands the player a sharpie: "Wall's
  that way. Everybody's on it." `done`. An overlay adds a line to the
  hallway panel for the rest of the week: "and, newest of all, whatever you
  just put there."
- **B. Out by the fire.** The episode closes in the yard: the log goes on,
  the music through the wall, the skunk line, and Gus, off the door at
  last, on the next stool: "You're alright, you know."
- **C. Next year's word.** Marnie's last line: "Since you're the only one
  who asked — next year's is *equanimity*. Don't tell Earl." Nothing set,
  nothing saved; a callback waiting for the roadside sign.
- **D. The morning after.** A second `enter: stamford` after `done`: plain
  light, Gus sweeping the walk, the board by overlay: THANKS, EVERYBODY.
  NEXT ONE WHEN YOU LEAST EXPECT IT.
- **E. A corner of the paper.** One prop line at the papered wall during
  the party: "Somebody's peeled a corner back. Behind the glass, the old
  pool's tiles catch the lights." A free tease for a later pool episode,
  once the Bel has been asked.
- **F. Somebody sings.** Thea gets somebody up between sets and it is
  Linnea, and the room does the last line for her.

Recommendation: B as the setting, A to set `done`, C as Marnie's last
line, D and E as cheap extras.

## The edgier menu

| Beat | Edge | Rule-6 read |
| --- | --- | --- |
| Gus on the door, and a word | A bouncer; friction | Fine: a game the whole town is playing, and Gus is pleased you know it. |
| Earl's wrong word; the right word is suspicious | A town that can't keep a secret | Fine: the joke is on the town; Earl gives it out of generosity. |
| A dress code | The shops have a job | Fine if the shops are the *help* and the rule is Marnie's fond one, never a fashion judgement. |
| The dark walk up Academy Street | Night, the leaning building | Fine: `dim` plus the notes' own spooky-outside, lovely-inside gag. Leave the building across the street out of it. |
| "Do you smell a skunk?" | Reads two ways; everyone by the fire smiles | Tom's call, explicitly. Also literally true; nobody in the scene is doing anything but sitting by a fire. |
| The sharpie wall | Already mentions penises | Tom-approved copy; don't escalate. |
| Real music, loud, on a stage | A DJ set | Fine. Never a fiddle. |
| Karaoke, badly | Gloriously bad | Fine if everyone is cheering and the singer is invented and loving it. |
| The bathroom queue | The out-of-order door | Tom's exception (b). A queue that chats, not a complaint. |
| Drinks | It is a bar | "Something in a glass"; nobody is drunk, nobody drives. |
| Teo and Birdie everywhere | Mild uncanniness | Fine: said once, by them, fondly about themselves. |

Not on the menu: anything about the real Belvedere's condition beyond
"looks spooky, is lovely"; any real private person; the honey wagon joke
pointed at anybody's plumbing; any guess at the record shop's real name.

## Music

Tom's call: real music over chiptune, freely available, source credited.
Engine proposal in DESIGN.md §3d; the content side:

- **Best: real local music, opted in.** A track or a short mix from
  someone who actually plays the Bel, under CC BY 4.0 or their own written
  grant recorded in `credits.json`, credited in-game like a painting:
  "Music at the Bel this week by ___." The record shop opening the same
  week the party needs a DJ is the natural conversation to have with both.
- **Meanwhile: freely licensed real recordings.** Free Music Archive
  filtered to CC BY / CC0; the Internet Archive's netlabels; Kevin
  MacLeod's produced catalogue (incompetech.com, CC BY 4.0). Picking exact
  tracks needs a browser session with access to those sites; three
  candidates, Tom listens and picks.
- **Two cues from one track.** Loud over the stage; the same track at half
  volume in the yard.
- **Licence rule.** CC0, CC BY 4.0, or a direct grant. ShareAlike and
  NonCommercial are out. Credit: title, artist, source link, licence.
- **Human-made only**, the same rule as art. Tom's call to write it into
  CONTRIBUTING.

## Engine: what exists, what is needed

| Beat | Mechanism | Status |
| --- | --- | --- |
| SATURDAY. YOU KNOW. board | overlay with a prop, `requires: []` | exists |
| The town almost saying it | `smallTalk` | exists |
| The cast, with day and night lines | episode `npcs`, first-match dialogue | exists |
| **Empty by day, full by night** | NPC `requires`, the mirror of `until` | **proposed**, DESIGN.md §3e; reverses §3's "no opposite of `until`". Day-Gus (`until: partyOn`) and night-Gus (`requires: partyOn`) are two entries, same name and look. |
| **Teo and Birdie in both shops and at the Bel** | three entries each, same name and look, different ids | exists; the same trick. A painted sprite would be one PNG copied to each id, which is a small cost for the joke. |
| Two outfits, one per shop | two carried-only items handed in dialogue, both setting `hasOutfit`; the second shop's `hasOutfit` entry comes first | exists (ep002's costume bag). No `unless` needed. |
| Wearing it on the sprite | `wardrobe`: flag-derived `look` for the player | **proposed**, §3e; fallback is the With-you panel |
| The stairwell opens, the paper comes off | this episode's overlay on `[91, 25]` with an open-stairs tile | exists, once there is an open variant of the `stairs` tile |
| The record shop | a new room spec and a building/exit entry for it, reached down the stairs | **content**: a room, no engine work; the stairwell tile needs to become a real exit, which today means a building entry in `world.json` rather than an overlay (overlays can't add exits; §3e) |
| Core Values on the map, and its room | a building on the north side of Main in a reserved lot, and a room | **map work**, notes "Open items"; no coordinates guessed |
| Night falls | `on: { flag: "partyOn" }`: toast + `light: dim, keep` | exists. If the second thing was handed over inside the Bel, the crowd appears around the player and the party scene waits for them to step out and back in, which the dialogue tells them to do. |
| The door, the lights, the DJ, Linnea in behind | `enter` scene with `requires: ["partyOn"]`: `say`, `light: party` over the stage tiles, `camera: npc:wren`, `move`, `set` | exists |
| Music, loud then through a wall | `music` step with `volume` | **proposed**, §3d |
| Log on the fire | carry verbs + `glow` | exists |
| The wall gets a line; the board changes in the morning | overlays gated on `done` | exists |

Flags, first draft: `heardAsk`, `earlsWord`, `gotWord`, `hasOutfit`,
`metTB`, `partyOn`, `letIn`, `done`. Eight.

## Decisions still open

1. **The ending**: which of A–F, and which sets `done`.
2. **The record shop in-game.** It has no name yet and is a real business
   about to open, so: refer to it as the record shop under Stamford Coffee
   with "the sign's on order", build the room, and have the heads-up
   conversation before launch. The person unpacking boxes is invented and
   unnamed until Tom says.
3. **Outfits on the sprite** (`wardrobe`), or on the With-you panel only.
4. **Music**: ask the Bel's people first, or ship a CC BY track and swap
   later. Recommendation: both.
5. **The lights**: drifting discs over the stage as built, or reverse the
   no-flash call for this room.
6. **NPC `requires`**: reverse the documented decision, or have the night
   cast walk in during the scene as the demo does (thinner).
7. **Teo and Birdie**: names, and whether they are recognisably a real pair
   who need to opt in.
8. **Core Values by name**: heads-up before launch, same as the others.
