# What's the Word — draft script

Every line a player can read in the Belvedere party episode, in the order
the engine would evaluate it, tagged `[speaker N]` so a note can point at
one. Hand-written ahead of the JSON (the engine features it needs — NPC
`requires`, `wardrobe`, `music`, `choices` — are not built yet, so there is
nothing for `episode-script` to print). When the JSON exists this file goes
away and the printed script replaces it. Treatment and decisions:
`docs/route10-bel-party.md`. Rules: `docs/writing-episodes.md`.

Third pass (Sep 13), after two cold reads by people with no other context —
one playing it as a player, one reading it as a local. What they caught:
the honey wagon was defined only in a random walker line (Marnie says it
now, once); Marnie gave away the lantern joke by day (she doesn't now, Gus
has it at the door); Gus and Marnie disagreed about who hands out the
password (fixed: she'd tell anyone, nobody asks); Marnie warned against
writing it on the wall while it was drawn on the wall (she knows about the
drawing now); "Utsayantha" was a door option nobody had said aloud (a
walker says it); Oda and Bram said an identical sentence; Birdie gave
directions like a tour guide; and a couple of dozen lines had tails,
winks or brochure phrasing. It is "the Bel" in every mouth but Linnea's,
who is new, and the intro card's.

Entries are first-match: the first whose `requires` all hold is the one
said. `→` marks an effect.

Flags: `heardAsk`, `askedMarnie`, `hasJacket`, `hasShirt`, `hasTie`,
`metTBcv`, `metTBrec`, `partyOn`, `saidWord`, `sangIn`, `letIn`, `done`.

---

## Intro

> The chalkboard outside the Belvedere, up Academy Street, says SATURDAY.
> YOU KNOW. Earl, out front of Stewart's, probably does.

## Small talk (ambient walkers, all week)

1. Saturday night at the Bel? I'm not supposed to say.
2. I went up to the Bel last year in my work boots and danced all night in them.
3. The paper's off that window under Stamford Coffee. It's a record shop, of all things.
4. Septic truck was up our road this morning. The honey wagon. Half the street came out to watch.
5. The password for Saturday? Everybody in town's got one. I don't think two of them match.
6. My good jacket's been on the back of the door since Tuesday so I don't forget it.
7. Somebody's been up a ladder inside the Bel all week, hanging lights.
8. Somebody said Saturday's password out loud in the bread aisle at Tops. The whole aisle went quiet.
9. Utsayantha's clear today. You can see the fire tower from Main Street.
10. If you hear singing coming down Academy Street on Saturday night, that's normal.
11. Two guys have been hauling speakers up Academy since noon.

## Overlays and props

- **Board by the Bel's door** (all week): A chalkboard on the walk, one line, careful capitals: SATURDAY. YOU KNOW.
- **The sharpie wall inside the Bel**, added this week to the wall's own lines: Fresh among the drawings: a truck with a big tank on the back and a hose off the side. Under it, THIS YEAR.
- **The stairwell on Stamford Coffee's deck** (all week, replaces ep002's): The paper's off the little window and the plywood's gone. Stairs go down under the coffee shop, and there's music coming up them.
- **Mill Pond Inn, at the door**: The coat hook by the door: a dog lead, a scarf nobody's claimed, and a note in pen. TOOK MY HAT BACK. D.

---

## Stamford, by day and night

### Earl — outside Stewart's

- `[earl 1]` requires `done`: Last night up at the Bel? I heard the singing from down here. Good night, that was.
- `[earl 2]` requires `partyOn`: Look at you. Going up the Bel? Password's lantern. Don't say where you got it.
- `[earl 3]` requires `heardAsk`: The password? Lantern. I'd write it down if I were you.
- `[earl 4]`: The board? That's Marnie's. She's got the bar up there. Saturday she shuts the door and you need a word to get in. / And you dress. Show up in your work clothes, she'll send you home. / Word's lantern. You didn't get it from me. → `heardAsk`

### Linnea — foot of Academy Street (gone once `letIn`)

- `[linnea 1]` requires `partyOn`: The Belvedere? You're going up? I've been standing on this corner half an hour. It looks like it's leaning. / I'll come in behind you. Don't let the door shut.
- `[linnea 2]`: The Belvedere? That's really where everybody goes on a Saturday? It looks like it's leaning. / I've been in town three weeks. I keep getting as far as this corner.

---

## The Bel by day (before `partyOn`)

### Marnie — behind the bar (all week)

- `[marnie 1]` requires `done`: Last night? That was a good one. Next year, new word.
- `[marnie 2]` requires `letIn`, `sangIn`: You sang? Good. I like that better than the password.
- `[marnie 3]` requires `letIn`, `saidWord`: You had the word? Gus came off the door to tell me. Nobody ever just asks me. I could've hugged you.
- `[marnie 4]` requires `askedMarnie`: The password? Still honey wagon. Don't wear it out.
- `[marnie 5]`: The password for Saturday? Honey wagon. The septic truck. / Don't write it on the wall in the back. Somebody drew it already, but a drawing doesn't count. → `askedMarnie`

### Gus — at the foosball (gone once `partyOn`)

- `[gus-day 1]`: This thing? I've been beating myself at it since March. Come back tonight.

### Wren — on the stage (gone once `partyOn`)

- `[wren-day 1]`: Sound check. You're standing in front of the speaker.

---

## Core Values

### Oda — the counter

- `[oda 1]` requires `hasJacket`: The green blazer? It's yours. Bring it back Monday, or don't.
- `[oda 2]` requires `hasShirt`: For Saturday? Rack by the door. Half of Stamford's been through it already. / The green one. Velvet. Nobody's been the right size till you. Take it. / Go on, it's getting dark. They'll have the door shut. → hands over **the green velvet blazer**, `hasJacket`, `partyOn`
- `[oda 3]`: For Saturday? Rack by the door. Half of Stamford's been through it already. / The green one. Velvet. Nobody's been the right size till you. Take it. → hands over **the green velvet blazer**, `hasJacket`

### Teo — at the rack

- `[teo-cv 1]` requires `metTBrec`: Oh. Hi again. → `metTBcv`
- `[teo-cv 2]`: The rack? Everything good on it has been through our hands twice. → `metTBcv`

### Birdie — at the rack

- `[birdie-cv 1]` requires `hasTie`: That's Renata's bow tie. Good. That's the neck sorted.
- `[birdie-cv 2]` requires `hasShirt`: That's Ray's shirt. It wants a jacket over it, and something at the neck. / Renata down at Cellar Door, in Hobart, has a velvet bow tie. Wore it to the opening under the coffee shop. / And somebody left a good hat on the hook at the Mill Pond Inn, up in Jefferson. Been there since pizza night.
- `[birdie-cv 3]`: Core Values? Thirty years, and I've never once left without a book.

### Props

- **The rack by the door**: A rail of jackets and shirts pulled round by the door, with a card on it: FOR SATURDAY AT THE BEL. Half of it's gone already.
- **The shelves**: People bringing things in and taking things out. Kitchen things, coats, a shelf of books that's different every week.

---

## The record shop under Stamford Coffee

### Bram — unpacking boxes

- `[bram 1]` requires `hasShirt`: Ray's shirt? Suits you. Whoever Ray was.
- `[bram 2]` requires `hasJacket`: The rail? That's for sale too, once I find the tags. / The bowling shirt. Says Ray on it. It's your size, take it. / Go on, it's dark. I'll be up once I've found the tags. → hands over **Ray's bowling shirt**, `hasShirt`, `partyOn`
- `[bram 3]`: The rail? That's for sale too, once I find the tags. / The bowling shirt. Says Ray on it. It's your size, take it. → hands over **Ray's bowling shirt**, `hasShirt`

### Teo — at the rail

- `[teo-rec 1]` requires `metTBcv`: Oh. Hi again. → `metTBrec`
- `[teo-rec 2]`: The rail? Start at the left. We've been through the right half already. → `metTBrec`

### Birdie — at the rail

- `[birdie-rec 1]` requires `hasTie`: That's Renata's bow tie. Good. That's the neck sorted.
- `[birdie-rec 2]` requires `hasJacket`: That green blazer? We saw it at Core Values on Tuesday and left it for somebody. Glad it was you. It wants something at the neck. / Renata down at Cellar Door, in Hobart, has a velvet bow tie. Wore it to the opening here. / And somebody left a good hat on the hook at the Mill Pond Inn, up in Jefferson. Been there since pizza night.
- `[birdie-rec 3]`: This place? Open two days and it already smells like a record shop.

### Props

- **The crates**: LPs in crates, sorted by nothing yet. A handwritten card says BROWSE, WE'LL FIGURE OUT THE ORDER LATER.
- **The wall**: Album covers going up one at a time, a hammer on the floor under the next gap.
- **Where the sign goes**: A nail by the door with nothing on it. Taped under it: SIGN'S ON ORDER.

### Two who guessed wrong (ep002's rumour, one line each)

- `[fern 1]` (Stamford Coffee): The shop downstairs? Records. I had my money on a gallery. Album covers on the wall, though. I'm counting it.
- `[ozzie 1]` (80 Main): The shop under the coffee shop? Records. I'd have been happy with oysters.

---

## Out of town

### Renata — Cellar Door Wines, Hobart

- `[renata 1]` requires `done`: Last night at the Bel? Three people have told me already and it's not ten yet.
- `[renata 2]` requires `hasTie`: The bow tie? It suits you better than it did me.
- `[renata 3]`: A bow tie? I've got one. Velvet. Wore it once, to the record shop opening up in Stamford. Take it. → hands over **Renata's velvet bow tie**, `hasTie`

### Dot — outside Middle Brook Cafe, Jefferson

- `[dot 1]` requires `done`: The Bel last night? Even up here we heard about it.
- `[dot 2]`: My hat? It sat on the hook at the Mill Pond Inn a month before I missed it. / Birdie tell you it was still there? She's a week behind. It's staying on my head.

---

## Night falls (scene, on `partyOn`)

> toast: The light's gone off the hills, and up Academy Street the Bel is lit.
> light: dim, kept.

---

## The Bel by night (`partyOn`)

### Gus — inside the door (gone once `letIn`)

- `[gus-door 1]`: Evening. What's the word?
  - **Honey wagon** → Honey wagon. Huh. Nobody's said that all night. / Who told you? Marnie? Off the wall? Either way. / In you go. Nice shirt, Ray. → `saidWord`
  - **Lantern** → Lantern? That was last year's. Earl's been handing it out again. / No word, you sing one. Everybody does. Up you go. → `sangIn`
  - **Utsayantha** → Utsayantha? That's the mountain. / No word, you sing one. Everybody does. Up you go. → `sangIn`
  - **I don't have it** → No word? Nobody does, first time. / You sing one. Everybody does. Up you go. → `sangIn`

### Scene: the right word (on `saidWord`)

> light: party, over the stage. Wren, the DJ, steps up onto the stage and the
> music comes up. The camera stays on the stage a beat, then comes back.
> Gus, to the next one in the door: Lantern? Earl again. Up you go.
> → `letIn`. toast: In.

### Scene: the house rule (on `sangIn`)

> The player is walked up the room and onto the stage. light: party, over
> them. music: down to a murmur.
> You don't know the words. The room does.
> The last line comes back at you from every table.
> music: up. The player is walked back down off the stage.
> → `letIn`. toast: In.

### Marnie — see above, `[marnie 2]` and `[marnie 3]`

### Wren — on the stage

- `[wren 1]` requires `done`: Last song? I said that two songs ago.
- `[wren 2]`: The records? Half this crate came up from Bram's this afternoon. The new place under Stamford Coffee.

### Thea — by the stage

- `[thea 1]` requires `sangIn`: You? You've had your turn up there. Somebody else. Linnea, come here.
- `[thea 2]`: Somebody's got to get up there between songs. Not me. You? No. Somebody.

### Vera — at the tables

- `[vera 1]`: Looking for a chair? Anywhere. Not that one, that's Hal's coat.

### Hal — the queue for the one bathroom

- `[hal 1]`: The line? Other bathroom's still out of order. You meet everybody here eventually.

### Teo — at the bar

- `[teo-bel 1]`: Tonight? We've not missed one. Birdie keeps count.

### Birdie — at the bar

- `[birdie-bel 1]` requires `hasTie`: The bow tie. Told you it wanted something at the neck.
- `[birdie-bel 2]`: Your outfit? It still wants something at the neck. Next year.

---

## The yard (`letIn`)

> On first entering: Out back, the music comes through the wall at half
> volume. A fire, a ring of stools, and three people who came out for air.

### Noor — by the fire

- `[noor 1]`: Do you smell a skunk? / Every night about this time. It's the Catskills.

### Kit — on a stool

- `[kit 1]` requires `done`: Staying? Fire's good till two.
- `[kit 2]`: The fire? Somebody put a log on it. Not me, I just sat down.

### Linnea — by the woodpile

- `[linnea-yard 1]` requires `done`: That hill I wouldn't walk up? It doesn't look like anything now.
- `[linnea-yard 2]`: Inside? I've been asked to trivia on Thursday. I've got a team.

### Gus — on the next stool

- `[gus-yard 1]` requires `done`: Ray. Stay as long as you like.
- `[gus-yard 2]` requires `sangIn`: Off the door. Everybody who's coming is in. / First time up the hill and you sang. / You're alright, Ray. → `done`, toast: Episode complete
- `[gus-yard 3]`: Off the door. Everybody who's coming is in. / You're alright, Ray. → `done`, toast: Episode complete

### The fire and the woodpile — as built

- Woodpile: You take a split log off the pile. Dry, and lighter than it looks.
- Fire: You set the log on the fire and it catches. / Everybody round the ring leans back an inch, and somebody says thanks without looking up.
