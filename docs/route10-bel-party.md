# The party at the Bel — story treatment

A treatment, not an episode: nothing here is built. It answers Tom's ask
(Sep 2026): a storyline whose payoff is a party at the Belvedere, using the
lighting and scene mechanics that already exist, with real music if we can
get it freely, with a trip to Core Values for an outfit, and a bit more
edge than the episodes so far. Revised after Tom's first read (party inside
the Bel on the stage; the bar open and quiet by day, the party at night once
the errands are done; a chill hang outside; "honey wagon" is the word;
Linnea is fine; real music over chiptune, with the source credited).
Decisions still open are collected at the end.

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
  coloured discs over any tiles we name (the stage, say), `dim` for evening
  outdoors, `glow` on the fire, camera pans, NPCs walking in, a chalkboard
  overlay. `demo-party.json` is a working eight-step version of "the lights
  come up" with a cast of four (Vera, Wren the DJ, Gus, Thea). The lights
  drift and breathe; there is no strobe, by Tom's earlier call — if the
  party wants a flash, that is Tom reversing a decision, and a small one in
  `engine/lighting.ts`.
- **Items, carry verbs and the With-you panel**: the outfit is an episode
  item the player carries until a flag closes it out.
- **Marnie** is the bar's permanent person; the episode takes her over by
  id and gives her the week's lines.
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
"Speakeasy Night", "Honey Wagon".

**Logline.** The Bel is doing a speakeasy night. There are no flyers; the
board out front says only SATURDAY. YOU KNOW. — and you don't. Two things
get you in the door after dark: the word, and not turning up in what you
wore to work. Core Values has kept a rack back. The town has been told to
keep the word a secret, and the town is terrible at it.

**Why this one.** It takes the two things the notes already flag about the
Bel — it looks like the spookiest building in Stamford and is the warmest
room in it, and it calls itself a speakeasy — and makes them the mechanic.
The thrift shop has a real reason to be in the story. The comedy is the
small-town-density irony from the notes: everyone knows everything, so a
password is impossible to keep and nobody can remember which one is
current. And the heart is the notes' "first time visiting" beat turned
round: the player arrives as the outsider and ends the week as the one who
talks a nervous newcomer through the sus door.

## Day and night

The episode has two halves on the same maps, switched by one flag,
`partyOn`, that lands the moment the player has both the word and the
outfit.

**By day** Stamford is in ordinary light and the Bel is open and nearly
empty, the way a bar is at three in the afternoon: Marnie behind the bar,
Gus alone at the foosball ("only person in here before six, most days"),
Wren up on the stage running cables ("Sound check. Come back when it's
dark and this is going to be a different room"). Nobody else.

**By night** — the moment `partyOn` lands — Stamford goes to `dim` and
stays there, and the Bel fills: the DJ on the stage with the lights over
it, a crowd at the bar and the tables, Gus just inside the door asking for
the word, Thea and Vera and a dozen townspeople, Linnea coming in behind
you. The yard is the chill hang: the fire, the stools, three people
talking quietly, the music coming through the door at half volume.

There is no timer. Night is what happens when you've done the things, and
the day version is simply the same building before anybody's arrived.

## The shape

Stamford-only for the errand, so the hill up Academy Street gets walked
three or four times and the town gets smaller and friendlier each time.
Jefferson and Hobart hear about it in small talk.

### Beats

1. **Hook.** Intro line: "Nobody in Stamford will say what's happening at
   the Bel on Saturday. That is how you know something is." The chalkboard
   overlay by the Bel's door reads SATURDAY. YOU KNOW. Every ambient walker
   is almost saying it (`smallTalk`, at least ten lines: "I'm not supposed
   to say. Ask Earl, he'll say.", "Everybody's got the word except the one
   person who's meant to give it out — no, wait, that's not it.", "I went
   up last year in my work boots and Gus made me take them off and dance in
   my socks. Best night I had all year.").

2. **Earl tells the whole truth at once.** Outside Stewart's: speakeasy
   night up the hill; two things get you in the door after dark — the word,
   and looking like you came for a party; Marnie gives the word to anybody
   who asks her nicely, only everybody thinks it's a secret so nobody asks;
   Core Values has had a rack put by all week. Then, unprompted and
   certain: "The word's *lantern*, by the way. Save you the trip." Sets
   `heardAsk`, `earlsWord`. (The one thing Earl gets wrong, he gets wrong
   generously — see "The wrong word" below.)

3. **The Bel by day.** The player can walk straight in. Marnie, on the
   first ask, no withholding: "The word? Course. It's *honey wagon* — don't
   write it on the wall, that's how last year's got out." Sets `gotWord`.
   With `earlsWord` and not `gotWord`, she gets there via the gag: "Lantern?
   That's last year's. Earl. He's told everybody. Every year he tells
   everybody last year's, and every year Gus lets them all in anyway." Wren
   on the stage and Gus at the foosball are colour: the stage is where
   it's going to happen, and it's empty now.

4. **Core Values.** On the north side of Main. A volunteer at the counter
   (unnamed until Tom names them — real counter, see notes "People") has
   the party rack pulled round by the door: "Half of Stamford's been in.
   Take what fits, bring it back Monday if you like, or don't — that's
   rather the point of the place." One outfit, or a pick of three (see
   Engine). Sets `hasOutfit`; the outfit sits on the With-you panel until
   the night is over. Copy about the shop is what it is: thirty years of
   people bringing things in and taking things out, a book you didn't know
   you wanted, the rack that's always exactly your size the week you're not
   looking. Nothing about price, condition or clutter.

5. **The newcomer at the bottom of the hill.** Linnea is standing at the
   foot of Academy Street looking up at the building, not going. By day:
   "Is that... is that really where everyone's going? It looks like it's
   leaning." Once the player has both things: "It's lovely inside. Come on.
   I'll do the word, you just say hello." She walks up behind you. This is
   the notes' first-time-visitor beat with the roles swapped, and it is the
   line that makes the episode about the player belonging somewhere rather
   than about a password.

6. **Night falls.** Whichever of the word and the outfit comes second sets
   `partyOn` (two dialogue variants, first-match ordered). A scene on that
   flag: toast "The light's going off the hills." and `dim` on Stamford,
   kept. Whoever hands over the second thing says to come back after dark,
   so the player leaves the room and walks up the hill in the evening: the
   Bel the warmest window on the street, its door the only one with a sound
   coming out of it.

7. **The door.** Entering the Bel with `partyOn` runs the party scene. Gus
   is just inside the door now. "What's the word?" — and the twist (below):
   the right word is the suspicious one. Then the lights come up over the
   stage, the music starts, the camera looks up the room at the DJ and
   hands back, Linnea comes in behind. Sets `letIn`.

8. **The party.** Free roam, nothing required, everything findable:
   - **The stage.** Wren on it, the discs drifting over it, the crowd
     facing it. Real music (below), the whole room's worth.
   - **The bar.** Marnie, run off her feet and delighted: "Told you.
     Nobody ever asks."
   - **Foosball**, a grudge match that has been running since March.
   - **Thea** trying to get somebody up to sing between sets.
   - **The one working bathroom**, with a small friendly queue that chats
     (Tom's exception (b)). "Lantern gets you the *other* door," says
     somebody in it, nodding at CLOSED UNTIL FURTHER NOTICE.
   - **The wall.** Every hand in town. Yours, by the end.
   - **The yard: the chill hang.** Out the hallway door the music drops to
     half through the wall, and it is the fire, the stools, the woodpile
     and three people who came out for air. Put a log on the fire (`glow`,
     already built). Somebody says "Do you smell a skunk?" and somebody
     else says "Every night about this time. It's the Catskills." Linnea,
     ten minutes in, is out here already talking to two people.

9. **Ending.** See "Endings" — a pick for Tom.

### The wrong word

Tom asked whether something funny should happen with the wrong password.
Three places it can, all buildable with first-match dialogue:

- **Marnie, by day.** The player brings Earl's "lantern" to her and she
  explains it, fondly: last year's; Earl tells everybody last year's, every
  year; Gus lets them in anyway. She gives the real one. (Beat 3.)
- **Gus, at the door.** The player, holding the *right* word, is the
  suspicious one: "Honey wagon? Nobody's said honey wagon all night. Who
  told you that? — Marnie? Marnie doesn't tell *anyone*. ... She did? Well.
  You must be alright, then." And, as you go past him, to the next person
  in the door: "Lantern. Yep. Earl. In you go." The password fails as a
  secret and succeeds as a party, which is the whole town in one exchange.
- **The bathroom queue.** "Lantern gets you the other door" — the
  out-of-order one. One line, and it gives last year's word a job.

The one thing the joke never is: at Earl's expense. He gives the word away
because he wants you there; everybody knows; "bless him" is the register.

### Endings

Tom asked to hear the ending ideas. Options, any two or three of which
stack; the mechanical `done` needs exactly one of them to set it.

- **A. The wall.** Marnie comes out from behind the bar — the one time in
  the pack she isn't "right here" — and hands the player a sharpie: "Wall's
  that way. Everybody's on it." `done`, toast "You're on the wall now." An
  overlay adds one line to the hallway panel for the rest of the week: "and,
  newest of all, whatever you just put there." Quietest, and it says the
  thing the episode is about.
- **B. Out by the fire.** The episode doesn't end in the noise. It ends in
  the yard: the log goes on, the music through the wall, the skunk line,
  and Gus, off the door at last, sits down on the next stool: "You're
  alright, you know." `done` on his line. Recommended as the *place* the
  episode closes, with A as the thing that closes it.
- **C. Next year's word.** Marnie's last line: "Since you're the only one
  who asked — next year's is *equanimity*. Don't tell Earl." Nothing is
  set, nothing is saved; it is a line for the player to carry, and a
  callback waiting for any later Bel episode (and for the roadside sign,
  once Tom has photographed it).
- **D. The morning after.** A second `enter: stamford` scene after `done`:
  plain light, the fire out, Gus sweeping the walk, and the board changed
  by overlay: THANKS, EVERYBODY. NEXT ONE WHEN YOU LEAST EXPECT IT. Cheap,
  and the week visibly changed something, which Tom liked about ep002.
- **E. A corner of the paper.** Not a room, just one prop line at the
  papered wall during the party: "Somebody's peeled a corner back. Behind
  the glass, the old pool's tiles catch the lights." A tease that costs
  nothing and sets up the pool for a future episode once the Bel has been
  asked.
- **F. Somebody sings.** Thea finally gets somebody up between sets, and it
  is Linnea, and the whole room does the last line for her. Warm, a bit
  loud, and it hands the newcomer arc its bow. Text and a `say` or two.

Recommendation: B as the setting, A to set `done`, C as Marnie's last
line, D and E as cheap extras. F if Tom wants the newcomer to get the last
word instead of the player.

## The edgier menu

What "edgier" can mean inside hard rule 6, each with a verdict. Tom picks.

| Beat | Edge | Rule-6 read |
| --- | --- | --- |
| A door with Gus on it, and a word | A bouncer; friction | Fine: a game the whole town is playing, and Gus is delighted you know it. Never a judgement of the player. |
| Earl's wrong word, and the twist that the right one is suspicious | Comedy of a town that can't keep a secret | Fine: the joke is on the town, Earl gives it out of generosity, "bless him." |
| A dress code | The thrift trip has teeth | Fine if the shop is the *help* and the rule is Marnie's fond one ("not what you wore to work"), never a fashion judgement. |
| The dark walk up Academy Street | Night, the leaning building | Fine: `dim` plus copy about the building looking spooky and being lovely — the notes' own gag. Leave the building across the street out of it. |
| "Do you smell a skunk?" | Reads two ways; everyone by the fire smiles | Tom's call, explicitly (he asked for it). Written so it is also literally true — the Catskills have skunks — and nobody in the scene is doing anything but sitting by a fire. |
| The sharpie wall, and adding to it | The wall already mentions penises | Already Tom-approved copy; the player's mark is theirs to imagine. Don't escalate the line. |
| Real music, loud, on a stage | A DJ set or a scrappy band | Fine. Notes: never a fiddle. |
| Karaoke, badly | Somebody being gloriously bad | Fine if everyone is cheering, and the singer is invented and loving it. |
| The queue for the one bathroom | The out-of-order door | Tom's standing exception (b). Keep it a queue where people chat, not a complaint. |
| Drinks | It is a bar | "Something in a glass" texture; no one is drunk, nobody drives. The world already has bottles at the coffee shop and a wine shop. |
| The morning after | Quiet street, Gus sweeping | Fine and rather nice; ending D. |

Not on the menu: anything about the real Belvedere's condition beyond
"looks spooky, is lovely"; any real private person; the honey wagon joke
pointed at anybody's plumbing.

## Music

Tom's call: real music over chiptune, freely available, source credited.
Engine proposal in DESIGN.md §3d; the content side:

- **Best: real local music, opted in.** The Bel does DJ nights and the
  occasional band. The truest version of this is a track or a short mix
  from someone who actually plays there, contributed under CC BY 4.0 (or a
  written grant recorded in `credits.json`) and credited in-game the way a
  painted building is: "Music at the Bel this week by ___." That is the
  project's whole contributor model applied to sound, and it is the
  heads-up conversation with the Bel anyway. Tom's to ask.
- **Meanwhile: freely licensed real recordings.** Free Music Archive
  filtered to CC BY / CC0 has real bands — plenty of garage, punk, house
  and lo-fi; the Internet Archive's netlabel collections likewise; Kevin
  MacLeod's catalogue (incompetech.com) is produced, not chiptune, CC BY
  4.0, and asks only for a findable credit. Picking exact tracks needs a
  browser session with access to those sites (this one's proxy blocks
  OpenGameArt and likely others), so that is a follow-up: three
  candidates, Tom listens and picks.
- **Two cues.** One for the room (the DJ set, loud, over the stage) and the
  same track at half volume in the yard, so stepping out for air sounds
  like stepping out for air. One track is enough for a first version.
- **Licence rule.** CC0, CC BY 4.0, or a direct grant from the artist. Our
  content is CC BY 4.0 and allows commercial use, so ShareAlike and
  NonCommercial tracks are out. Credit lives in `credits.json` and on the
  credits screen: title, artist, source link, licence.
- **Human-made only**, the same rule as art: no model-generated music
  under `worlds/`. Tom's call to say so in CONTRIBUTING.
- **Size.** A real three-minute track at 128 kbps is about 3 MB. Fine for a
  static site if it loads only when the party scene is about to need it,
  not at boot.

## Engine: what exists, what is needed

| Beat | Mechanism | Status |
| --- | --- | --- |
| SATURDAY. YOU KNOW. board | overlay with a prop, `requires: []` | exists (demo) |
| Everybody almost saying it | `smallTalk` | exists |
| Earl, Marnie (takeover by id), Wren, Gus, Thea, Vera, Linnea, the Core Values counter | episode `npcs` with `requires` dialogue | exists |
| **The room empty by day, full by night** | NPC `requires`: a declared flag before which the person is not on the map — the mirror of `until` | **proposed**, DESIGN.md §3e. This reverses §3's "deliberately no opposite of `until`"; the party is the first story where a room has to be empty and then full. Day-Gus (`until: partyOn`, at the foosball) and night-Gus (`requires: partyOn`, at the door) are two entries with the same name and look. |
| The outfit | carried-only episode item handed over in dialogue, `until: "done"` | exists (ep002's costume bag) |
| A pick of three outfits | `unless` on items and dialogue entries, mirroring overlays | **proposed**, DESIGN.md §3e; fallback is one outfit |
| Wearing it on the sprite | `wardrobe`: a flag-derived `look` change for the player | **proposed**, DESIGN.md §3e; fallback is the With-you panel only |
| Night falls | `on: { flag: "partyOn" }` scene: toast + `light: dim, keep` | exists. One wrinkle: if the second thing was handed over *inside* the Bel, the night crowd appears around the player and the party scene waits for them to step out and back in — which the dialogue tells them to do. |
| The door, the lights, the DJ, Linnea in behind | `enter` scene with `requires: ["partyOn"]`: `say`, `light: party` over the stage tiles, `camera`, `move`, `set` | exists (demo does most of it) |
| Music in the room and at half volume in the yard | `music` scene step with `volume` | **proposed**, DESIGN.md §3d |
| Log on the fire | carry verbs + `glow` | exists |
| The wall gets a new line | overlay prop on the hallway panel, `requires: ["done"]` | exists (check that an overlay prop can sit on a tile that already has a room-spec panel; else the tile beside) |
| The board changes in the morning | second overlay on the same tile, `requires: ["done"]`, listed later so it wins | exists |
| Core Values on the map | a building on the north side of Main, in a reserved lot | **map work**, see notes "Open items"; no coordinates guessed here |

Flags, first draft: `heardAsk`, `earlsWord`, `gotWord`, `hasOutfit`,
`partyOn`, `letIn`, `done`. Seven, about ep002's weight.

## Decisions still open

1. **The ending**: which of A–F, and which sets `done`. Recommendation
   above: B as the setting, A to close, C as the last line, D and E as
   extras.
2. **Outfit: one, or a pick of three, and does it show on the sprite?**
   Recommendation: pick of three showing on the sprite — it is the one
   place the player gets to express something, and the extensions are
   small and general.
3. **Music: ask the Bel's own people first, or ship a freely licensed real
   track and swap later?** Recommendation: both — ship a CC BY track so
   the feature exists, and replace it the week a local one comes in.
4. **The lights**: the drifting party discs over the stage as built, or
   does Tom want to reverse the no-flash call for this room?
5. **NPC `requires`**: it reverses a documented decision in DESIGN.md §3.
   The alternative is to give the daytime Bel no scene-cast at all and
   have the night cast walk in through the door during the party scene,
   which is what the demo does and is thinner.
6. **The Core Values volunteer**: named or not (real counter).
7. **Core Values by name** on the map and in the story: a real business,
   so a friendly heads-up before launch, same as the others.
