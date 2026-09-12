# The party at the Bel — story treatment

A treatment, not an episode: nothing here is built. It answers Tom's ask
(Sep 2026): a storyline whose payoff is a party at the Belvedere, using the
lighting and scene mechanics that already exist, with music if we can get it
freely, with a trip to Core Values for an outfit, and a bit more edge than
the episodes so far. Decisions for Tom are collected at the end.

Everything below runs through CLAUDE.md hard rules 5 and 6 before it reaches
a player: real businesses by name with affection only, invented people
everywhere else, every line warm. "Edgier" here means more night, more
friction, more of the Bel's own cheek — never a line at anyone's expense.

## What we already have

- **The Bel, inside and out**, built to Tom's two walk-throughs: the narrow
  front room, the peninsula bar with Marnie inside it, the blackboard wall,
  the papered wall with the dry pool behind it, foosball, the hallway with
  the sharpie wall and the two bathrooms (one closed until further notice),
  and the yard with the firepit and the woodpile you can take a log off.
- **Scenes and lighting** (DESIGN.md §3): `party` mode with drifting coloured
  discs, `dim` for evening outdoors, `glow` on the fire, camera pans, NPCs
  walking in, a chalkboard overlay. `demo-party.json` is a working
  eight-step version of "the lights come up" with a cast of four (Vera,
  Wren the DJ, Gus, Thea).
- **Items, carry verbs and the With-you panel**: an outfit can be an episode
  item the player picks up and carries until a flag closes it out.
- **Marnie** is the bar's permanent person; an episode can take her over by
  id and give her the week's lines without the player meeting two of her.
- **Real facts to lean on.** The Bel calls itself a speakeasy-style dive bar
  (its own public description), it is the last building still operating
  from the hotel era when Stamford was the Queen of the Catskills, DJ nights
  and the occasional scrappy punk band are what plays there, and Core
  Values is a real thrift workshop at 112 Main Street, Stamford — thirty-odd
  years old, clothes and housewares and books, run on the idea of people
  helping each other by sharing and salvaging. (Notes in
  `docs/route10-notes.md`.)

## The pitch

**Working title: "What's the Word."** Alternatives: "Saturday. You Know.",
"Speakeasy Night", "The Back Room".

**Logline.** The Bel is doing a speakeasy night. There are no flyers; the
board out front says only SATURDAY. YOU KNOW. — and you don't. Two things
get you into the back: the word, and not turning up in what you wore to
work. Core Values has kept a rack back. The town has been told to keep the
word a secret, and the town is terrible at it.

**Why this one.** It takes the two things the notes already flag about the
Bel — it looks like the spookiest building in Stamford and is the warmest
room in it, and it calls itself a speakeasy — and makes them the mechanic:
the player gets turned away at a door, goes and gets the two things, and
comes back to the best night of the week. The thrift shop has a real reason
to be in the story. The comedy is the small-town-density irony from the
notes (everyone knows everything, so a password is impossible to keep and
nobody can remember which one is current). And the heart is the note's
"first time visiting" beat, turned round: the player arrives as the
outsider and ends the week as the one who talks a nervous newcomer through
the sus door.

## The shape

Stamford-only for the errand, so the hill up Academy Street gets walked
three or four times and the town gets smaller and friendlier each time.
Jefferson and Hobart hear about it in small talk. No timers: "Saturday" is
flavour, the party happens the evening the player is ready.

**Front and back.** The Bel's front room is open all week as usual —
Marnie, foosball, the wall. The party is through the hallway, in the yard
and (see the stretch ending) the pool room, and **Gus is on the hallway**.
This is the whole trick: the street door never has to be locked, Marnie is
reachable the whole time, and the thing the player is shut out of is the
back room, which is what a speakeasy is.

### Beats

1. **Hook.** Intro line: "Nobody in Stamford will say what's happening at
   the Bel on Saturday. That is how you know something is." The chalkboard
   overlay by the Bel's door reads SATURDAY. YOU KNOW. Every ambient walker
   is almost saying it (`smallTalk`, at least ten lines: "I'm not supposed
   to say. Ask Earl, he'll say.", "Everyone's got the word except the one
   person who's meant to give it out — no, wait, that's not it.", "I went
   up last year in my work boots and Gus made me take them off and dance in
   my socks. Best night I had all year.").

2. **Earl tells the whole truth at once** (ep002's lesson: the first stop
   is honest, no arrows). Outside Stewart's: speakeasy night up the hill,
   two things get you into the back — the word, and looking like you came
   for a party — Marnie gives the word to anybody who asks her nicely, only
   everybody thinks it's a secret so nobody asks; Core Values has had a rack
   put by all week. Then, unprompted and certain: "The word's *lantern*,
   by the way. Save you the trip." Sets `heardAsk`, `earlsWord`.

3. **The first walk up.** Player goes in, down the hallway; Gus fills it.
   "What's the word?" — with `earlsWord` and nothing else: "Lantern. That's
   last year's. Earl's been giving that one out all week, bless him — he
   gave it to me twice. Ask Marnie, she's right there. And come back
   dressed for it." Sets `turnedAway`. (This is the edge: a bouncer, a
   door that doesn't open, a wrong password. It stays kind because the
   whole town is in on the game and Gus is delighted you tried.)

4. **Marnie, on the first ask.** No withholding; she is a person: "The
   word? Course. It's *honey wagon* — no, don't write it on the wall,
   that's how last year's got out." Sets `gotWord`. If the player comes to
   her before Earl, she says the same thing and adds that Earl will try to
   give you a different one and to let him. (The word itself is Tom's call;
   see Decisions. "Honey wagon" is the notes' own silly local texture and
   makes the door exchange land; "equanimity", the roadside sign everybody
   drives past without reading, is the deeper local joke if the sign
   checks out.)

5. **Core Values.** On the north side of Main. A volunteer at the counter
   (unnamed until Tom names them — real counter, see notes "People") has
   the party rack pulled round by the door: "Half of Stamford's been in.
   Take what fits, bring it back Monday if you like, or don't — that's
   rather the point of the place." One outfit, or a pick of three (see
   Engine). Sets `hasOutfit`; the outfit sits on the With-you panel until
   the night is over. Copy about the shop is what it is: thirty years of
   people bringing things in and taking things out, a book you didn't know
   you wanted, the rack that's always exactly your size the week you're not
   looking. Nothing about price, condition or clutter.

6. **The newcomer at the bottom of the hill.** Linnea (invented; name to
   be checked) is standing at the foot of Academy Street looking up at the
   building, not going. Before `gotWord`: "Is that... is that really where
   everyone's going? It looks like it's leaning." After the player has the
   word and the outfit, the player is the one who knows: "It's lovely
   inside. Come on. I'll do the word, you just say hello." She walks up
   behind you (scene: `move` her to the door as you go in). This is the
   notes' first-time-visitor beat with the roles swapped, and it is the
   line that makes the episode about the player belonging somewhere rather
   than about a password.

7. **The second walk up, at dusk.** `dim` on Stamford once `gotWord` and
   `hasOutfit` both hold (an `on: { flag }` scene): the light off the
   hills, the Bel the warmest window on the street, its door the only one
   with a sound coming out of it.

8. **The door.** Gus, with both flags: "Honey wagon. And you've dressed.
   Go on through — and take that log off the pile on your way past, the
   fire's been waiting for you." Scene `letIn`: Gus steps out of the
   hallway (`move`), the front room's party lights come up behind you, the
   music starts (see Music), the camera looks down the hall and hands
   back. Linnea comes in the street door.

9. **The party.** The yard: DJ Wren in the corner ("Ten more minutes with
   these cables and this yard is going to sound enormous"), Thea, Vera, the
   fire, the woodpile. Beats the player can find in any order, none
   required: put a log on the fire (`glow`, already built); Thea trying to
   get somebody up for karaoke; a foosball grudge match that has been
   running since March; the one working bathroom with a small friendly
   queue (Tom's exception (b)); Linnea, ten minutes in, already talking to
   three people. Somebody says the word out loud across the yard and Gus
   says "*next* year's is going to be harder."

10. **Ending.** Marnie comes out from behind the bar for once — the one
    time in the pack she isn't "right here" — and hands the player a
    sharpie: "Wall's that way. Everybody's on it." Sets `done`, toast
    "You're on the wall now." An overlay on the hallway panel adds one line
    to the wall's copy for the rest of the week: "and, newest of all,
    whatever you just put there."

### Stretch ending: the pool

The papered wall comes down for the night and the party is in the hotel's
old pool room, the dry pool as the dance floor, the DJ in the deep end.
This is the memorable image, it is the building's most famous feature (the
mayor story is already in the trivia pool) and it is the kind of thing the
Bel itself does — pop-ups and special events are its own words. It costs a
new room (`the-belvedere-pool`, a room spec like the others, stairs down
into a tiled rectangle, lights over it) and one small schema extension: an
overlay that adds an exit, so the papered wall is a door only while the
party flag holds (see Engine). It also invents an event about a real
business's building, so it needs the friendly-heads-up conversation with
the Bel before it ships, and Tom's call on whether a party in an empty pool
reads as charming or as a liability. Recommendation: build the yard version
first, and add the pool as its own PR once the Bel has been asked.

## The edgier menu

What "edgier" can mean inside hard rule 6, each with a verdict. Tom picks.

| Beat | Edge | Rule-6 read |
| --- | --- | --- |
| Turned away at the door by Gus | Friction; a door that says no | Fine: a game the whole town is playing, and Gus is delighted you tried. Never a judgement of the player. |
| A password, and a wrong one from Earl | Comedy of a town that can't keep a secret | Fine: the joke is on the town, Earl gives it out of generosity, and Gus says "bless him." |
| A dress code | The thrift trip has teeth | Fine if the shop is the *help* and the rule is Marnie's fond one ("not what you wore to work"), never a fashion judgement. |
| The dark walk up Academy Street | Night, the leaning building | Fine: `dim` plus copy about the building looking spooky and being lovely — the notes' own gag. Leave the building across the street out of it. |
| The sharpie wall, and adding to it | The wall already mentions penises | Already Tom-approved copy; the player's mark is theirs to imagine. Don't escalate the line. |
| A scrappy punk band instead of a DJ | Loud, young, a bit rough | Fine. Notes: never a fiddle. Music choice below. |
| Karaoke, badly | Somebody being gloriously bad | Fine if everyone in the yard is cheering, and the singer is invented and loving it. |
| The queue for the one bathroom | The out-of-order door | Tom's standing exception (b). Keep it a queue where people chat, not a complaint. |
| Drinks | It is a bar | Keep to "something in a glass" texture; no one is drunk, nobody drives. The world already has bottles at the coffee shop and a wine shop, so a bar being a bar is fine. |
| The morning after | A second `enter: stamford` after `done`: quiet street, the fire out, Gus sweeping the walk | Fine and rather nice; optional. |

Not on the menu: anything about the real Belvedere's condition beyond
"looks spooky, is lovely"; any real private person; the word being
anything that could read as a dig; the honey wagon joke pointed at
anybody's plumbing.

## Music

Tom asked for music, freely available. Full engine proposal in DESIGN.md
§3d; the content side:

- **What plays.** Notes say DJ nights and sometimes a scrappy punk band,
  never a fiddle. For a pixel game, chiptune or lo-fi electronic is the
  honest fit and keeps the Bel from "sounding like" any real band: one
  short dance loop for the DJ yard (60–90 s, loops clean), optionally one
  pop-punk chiptune track if Tom wants the band beat instead.
- **Where from.** OpenGameArt's CC0 collections ("CC0 - Upbeat / Electronic
  Music", which includes a set of pop-punk chiptune tracks and dance loops;
  "CC0 Chiptunes"; "CC0 - Retro Music") need no attribution at all and are
  the first place to look. Kevin MacLeod's catalogue (incompetech.com) is
  CC BY 4.0 and only asks for a findable credit, which our credits screen
  already is. Free Music Archive, filtered to CC0 / CC BY. Picking exact
  tracks needs a browser session with access to those sites (this one's
  proxy blocks OpenGameArt), so that is a follow-up, ideally Tom listening
  to three candidates and picking.
- **Licence rule.** CC0 or CC BY 4.0 only — our content is CC BY 4.0 and
  allows commercial use, so ShareAlike and NonCommercial tracks are out.
  Credit lives in `credits.json` and on the credits screen, the same way
  art does.
- **Human-made only**, the same rule as art: no model-generated music
  under `worlds/`. Tom's call to extend CONTRIBUTING's "Where AI fits" to
  say so.
- **Quiet by default is still the game.** Music plays in scenes an episode
  asks for, and a HUD button mutes it. No ambient town music in v1.

## Engine: what exists, what is needed

| Beat | Mechanism | Status |
| --- | --- | --- |
| SATURDAY. YOU KNOW. board | overlay with a prop, `requires: []` | exists (demo) |
| Everybody almost saying it | `smallTalk` | exists |
| Earl, Marnie (takeover by id), Gus, Wren, Thea, Vera, Linnea, the Core Values counter | episode `npcs` with `requires` dialogue | exists |
| Gus blocking the hallway | an NPC standing on the one-tile hallway; a `move` in the `letIn` scene steps him aside | **verify**: that a story NPC parked in a one-wide hall blocks the player and that `validate-episodes` allows it. If not, the small extension is a gated door (DESIGN.md §3e). |
| The outfit | carried-only episode item handed over in dialogue, `until: "done"` | exists (ep002's costume bag) |
| A pick of three outfits | `unless` on items and dialogue entries, mirroring overlays | **proposed**, DESIGN.md §3e; fallback is one outfit |
| Wearing it on the sprite | `wardrobe`: a flag-derived `look` change for the player | **proposed**, DESIGN.md §3e; fallback is the With-you panel only |
| Dusk on the way up | `light: dim` in an `on: { flag }` scene with `keep: true` | exists |
| Lights up, Gus steps aside, Linnea comes in | scene: `move`, `light: party`, `camera`, `say`, `set` | exists |
| Music in the yard | `music` scene step | **proposed**, DESIGN.md §3d |
| Log on the fire | carry verbs + `glow` | exists |
| The wall gets a new line | overlay prop on the hallway panel, `requires: ["done"]` | exists (check that an overlay prop can sit on a tile that already has a room-spec panel; else place it on the tile beside) |
| The pool room | new room + overlay-added exit | **proposed**, DESIGN.md §3e; stretch |
| Core Values on the map | a building on the north side of Main, in a reserved lot | **map work**, see notes "Open items"; no coordinates guessed here |

Flags, first draft: `heardAsk`, `earlsWord`, `turnedAway`, `gotWord`,
`hasOutfit`, `letIn`, `done`. Seven, which is about ep002's weight.

## Decisions for Tom

1. **The word.** "Honey wagon" (silly, local, lands at the door),
   "equanimity" (the roadside sign — needs the photo first), or something
   else. Earl's last-year word can stay "lantern" or be whatever is funnier.
2. **The ending.** Yard and fire (buildable now), or the pool (memorable,
   needs the Bel asked and one engine extension). Recommendation: yard
   first, pool as a follow-up PR.
3. **Outfit: one, or a pick of three, and does it show on the sprite?**
   Recommendation: pick of three showing on the sprite, since it is the one
   place the player gets to express something and the extensions are small
   and general.
4. **Names.** Linnea for the newcomer, and whether the Core Values volunteer
   gets a name at all (real counter: Tom's check per the notes).
5. **Music.** Chiptune DJ loop, pop-punk chiptune band, or both; and the
   human-made-only rule for music.
6. **Which edgier beats** from the menu go in. Recommendation: the door,
   the wrong word, the dress code, the dark walk, the wall, karaoke, the
   bathroom queue. Skip the morning after for v1.
7. **Core Values by name** on the map and in the story: it is a real
   business, so a friendly heads-up before launch, same as the others.
