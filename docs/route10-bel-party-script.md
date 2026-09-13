# What's the Word — draft script

Every line a player can read in the Belvedere party episode, in the order
the engine would evaluate it, tagged `[speaker N]` so a note can point at
one. Hand-written ahead of the JSON (the engine features it needs — NPC
`requires`, `wardrobe`, `music`, `choices` — are not built yet, so there is
nothing for `episode-script` to print). When the JSON exists this file goes
away and the printed script replaces it. Treatment and decisions:
`docs/route10-bel-party.md`. Rules: `docs/writing-episodes.md`.

Second pass, on Tom's notes (Sep 13): every line has to stand on its own
for a player who knows nothing — name the building, name the person, say
what the honey wagon is, say what the house rule is. Nobody is "Gus" until
somebody has said who Gus is.

Entries are first-match: the first whose `requires` all hold is the one
said. `→` marks an effect.

Flags: `heardAsk`, `askedMarnie`, `hasJacket`, `hasShirt`, `hasTie`,
`metTBcv`, `metTBrec`, `partyOn`, `saidWord`, `sangIn`, `letIn`, `done`.

---

## Intro

> The chalkboard outside the Belvedere, up Academy Street, says SATURDAY.
> YOU KNOW. You don't. Earl, out front of Stewart's, probably does.

## Small talk (ambient walkers, all week)

1. Saturday night at the Belvedere? I'm not supposed to say.
2. I went up to the Belvedere last year in my work boots and danced all night in them.
3. The paper's off that window under Stamford Coffee. It's a record shop, of all things.
4. The septic truck came up our road this morning. Honey wagon, we call it. Half the street came out to watch it work.
5. The password for Saturday? Everybody in town's got one. I don't think two of them match.
6. My good jacket's been on the back of the door since Tuesday so I don't forget it Saturday.
7. Somebody's been up a ladder inside the Belvedere all week, hanging lights.
8. Somebody said Saturday's password out loud in the bread aisle at Tops. The whole aisle went quiet.
9. Academy Street's a long hill. Worth it on a Saturday.
10. If you hear singing coming down Academy Street on Saturday night, that's normal.
11. Somebody's been carrying speakers up Academy Street since noon.

## Overlays and props

- **Board by the Belvedere's door** (all week): A chalkboard on the walk, one line, careful capitals: SATURDAY. YOU KNOW.
- **The sharpie wall inside the Belvedere**, added this week to the wall's own lines: Fresh among the drawings, in a careful hand: a truck with a big tank on the back and a hose off the side. Under it, THIS YEAR.
- **The stairwell on Stamford Coffee's deck** (all week, replaces ep002's): The paper's off the little window and the plywood's gone. Stairs go down under the coffee shop, and there's music coming up them.
- **Mill Pond Inn, at the door**: The coat hook by the Mill Pond Inn's door: a dog lead, a scarf nobody's claimed, and a note in pen. TOOK MY HAT BACK. D.

---

## Stamford, by day and night

### Earl — outside Stewart's

- `[earl 1]` requires `done`: Last night up at the Belvedere? I heard the singing from down here. Good night, that was.
- `[earl 2]` requires `partyOn`: You look dressed for Saturday at the Belvedere. The password at the door is lantern. You didn't get it from me.
- `[earl 3]` requires `heardAsk`: The password for the Belvedere? Lantern. I'd write it down if I were you.
- `[earl 4]`: The board up at the Belvedere? Saturday night's a speakeasy night up there. Marnie, who runs the bar, has two rules: a password at the door, and nobody comes in what they wore to work. / The password's lantern. You didn't get it from me. → `heardAsk`

### Linnea — foot of Academy Street (gone once `letIn`)

- `[linnea 1]` requires `partyOn`: The Belvedere? You're heading up there? I've been stood on this corner half an hour. It looks like it's leaning. / If you're going in, I'll come in behind you. Just don't let the door shut.
- `[linnea 2]`: The Belvedere? That's really where everybody goes on a Saturday? It looks like it's leaning. / I've been in town three weeks. I keep getting as far as this corner.

---

## The Belvedere by day (before `partyOn`)

### Marnie — behind the bar (all week)

- `[marnie 1]` requires `done`: Last night? Best one we've had. Same time next year, and a different password.
- `[marnie 2]` requires `letIn`, `sangIn`: You sang your way in? Good. Better than the password, honestly.
- `[marnie 3]` requires `letIn`, `saidWord`: You gave the password at the door? Gus, on the door, came and told me. Nobody ever asks me for it. I could've hugged you.
- `[marnie 4]` requires `askedMarnie`: The password? Still honey wagon. Don't wear it out.
- `[marnie 5]` requires `heardAsk`: The password for Saturday? It's honey wagon. If Earl told you lantern, that was last year's. He does that every year, bless him. → `askedMarnie`
- `[marnie 6]`: The password for Saturday? It's honey wagon. Don't write it on the wall in the back. That's how last year's got out. → `askedMarnie`

### Gus — at the foosball (gone once `partyOn`)

- `[gus-day 1]`: This foosball table? I've been beating myself at it since March. Come back after dark, when there's somebody else to beat.

### Wren — on the stage (gone once `partyOn`)

- `[wren-day 1]`: The stage? I'm doing the sound check for Saturday. Come back after dark. This is going to be a different room.

---

## Core Values

### Oda — the counter

- `[oda 1]` requires `hasJacket`: The green blazer? It's yours. Bring it back Monday, or don't.
- `[oda 2]` requires `hasShirt`: Something to wear Saturday? That rack by the door is all for the Belvedere's party. Half of Stamford's been through it. / The green one. Velvet. It's been waiting all week for somebody your size. Take it. / It's getting dark out. Whatever's happening up that hill is happening soon. → hands over **the green velvet blazer**, `hasJacket`, `partyOn`
- `[oda 3]`: Something to wear Saturday? That rack by the door is all for the Belvedere's party. Half of Stamford's been through it. / The green one. Velvet. It's been waiting all week for somebody your size. Take it. → hands over **the green velvet blazer**, `hasJacket`

### Teo — at the rack

- `[teo-cv 1]` requires `metTBrec`: Oh, hello again. We were just down at the record shop with you. We do get around. → `metTBcv`
- `[teo-cv 2]`: The rack by the door? Everything good on it has been through our hands twice. → `metTBcv`

### Birdie — at the rack

- `[birdie-cv 1]` requires `hasShirt`: That bowling shirt? That's Ray's, whoever Ray was. It wants a jacket over it, and something at the neck. / Renata, who runs Cellar Door Wines down in Hobart, wore a velvet bow tie to the record shop's opening. And there's been a good hat on the coat hook at the Mill Pond Inn, up in Jefferson, since pizza night.
- `[birdie-cv 2]`: Core Values? Thirty years, and I've never once left without a book.

### Props

- **The rack by the door**: A rail of jackets and shirts pulled round by the door, with a card on it: FOR SATURDAY AT THE BELVEDERE. Half of it's gone already.
- **The shelves**: Thirty years of people bringing things in and taking things out. Kitchen things, coats, a shelf of books that changes every week.

---

## The record shop under Stamford Coffee

### Bram — unpacking boxes

- `[bram 1]` requires `hasShirt`: The shirt with RAY on it? Wear it well. Whoever Ray was.
- `[bram 2]` requires `hasJacket`: The clothes? The rail's for sale too, once I find the tags. / That bowling shirt, with RAY stitched over the pocket. It's your size. Take it. / It's getting dark out. Whatever's happening up that hill is happening soon. → hands over **Ray's bowling shirt**, `hasShirt`, `partyOn`
- `[bram 3]`: The clothes? The rail's for sale too, once I find the tags. / That bowling shirt, with RAY stitched over the pocket. It's your size. Take it. → hands over **Ray's bowling shirt**, `hasShirt`

### Teo — at the rail

- `[teo-rec 1]` requires `metTBcv`: Oh, hello again. We were just up at Core Values with you. We do get around. → `metTBrec`
- `[teo-rec 2]`: The rail of jackets? Start at the left. We've been through the right half already. → `metTBrec`

### Birdie — at the rail

- `[birdie-rec 1]` requires `hasJacket`: That green blazer? We saw it at Core Values on Tuesday and left it for somebody. Glad it was you. It wants something at the neck. / Renata, who runs Cellar Door Wines down in Hobart, wore a velvet bow tie to the opening here. And there's been a good hat on the coat hook at the Mill Pond Inn, up in Jefferson, since pizza night.
- `[birdie-rec 2]`: This place? Open two days and it already smells like a record shop.

### Props

- **The crates**: LPs in crates, sorted by nothing yet. A handwritten card says BROWSE, WE'LL FIGURE OUT THE ORDER LATER.
- **The wall**: Album covers going up one at a time, a hammer on the floor under the next gap.
- **Where the sign goes**: A nail by the door with nothing on it. Taped under it: SIGN'S ON ORDER.

### Two who guessed wrong (ep002's rumour, one line each)

- `[fern 1]` (Stamford Coffee): The shop downstairs? It's a record shop. I had my money on a gallery. There are album covers on the wall, so I'm counting it.
- `[ozzie 1]` (80 Main): The shop downstairs? Records. I'd have been happy with oysters.

---

## Out of town

### Renata — Cellar Door Wines, Hobart

- `[renata 1]` requires `done`: The party at the Belvedere last night? I heard it went late, even down here.
- `[renata 2]` requires `hasTie`: The bow tie? It suits you better than it did me.
- `[renata 3]`: A bow tie? I've got one. Velvet. Wore it to the record shop's opening up in Stamford, and it's had its night. Take it. → hands over **Renata's velvet bow tie**, `hasTie`

### Dot — outside Middle Brook Cafe, Jefferson

- `[dot 1]` requires `done`: The party at the Belvedere last night? Even up here in Jefferson we heard about it.
- `[dot 2]`: My hat? I left it on the coat hook at the Mill Pond Inn a whole month before I remembered it. It's back on my head now. You'll do fine without.

---

## Night falls (scene, on `partyOn`)

> toast: The light's gone off the hills, and up Academy Street the Belvedere is lit.
> light: dim, kept.

---

## The Belvedere by night (`partyOn`)

### Gus — inside the door (gone once `letIn`)

- `[gus-door 1]`: Evening. What's the word?
  - **Honey wagon** → Honey wagon? Nobody's said honey wagon all night. Who gave you that? / Marnie? Marnie doesn't tell anyone. / She did? Well. You're alright, then. In you go. Nice shirt, Ray. → `saidWord`
  - **Lantern** → Lantern? That was last year's. Earl's been handing it out again, hasn't he. / House rule: no password, you sing one song, and then you're in. Up you go. → `sangIn`
  - **Utsayantha** → Utsayantha? That's the mountain, not the password. Good guess, though. / House rule: no password, you sing one song, and then you're in. Up you go. → `sangIn`
  - **I don't have it** → No password? Nobody does, first time. / House rule: no password, you sing one song, and then you're in. Up you go. → `sangIn`

### Scene: the right word (on `saidWord`)

> light: party, over the stage. music: up.
> camera follows Wren onto the stage, a beat, back to the player.
> Gus, to whoever is behind you: Lantern? Earl again. Go on, one song, and you're in.
> → `letIn`. toast: In.

### Scene: the house rule (on `sangIn`)

> The player is walked up the room and onto the stage. light: party, over
> them. music: down to a murmur.
> You don't know the words. It turns out that doesn't matter. The room does.
> The last line comes back at you from every table.
> music: up. The player is walked back down off the stage.
> → `letIn`. toast: In.

### Marnie — see above, `[marnie 2]` and `[marnie 3]`

### Wren — on the stage

- `[wren 1]` requires `done`: Last song? Never. There's always one more.
- `[wren 2]`: The records? Half this crate came up the stairs from the new shop under Stamford Coffee this afternoon.

### Thea — by the stage

- `[thea 1]` requires `sangIn`: You again? You've had your turn up there. Somebody else. Linnea, come here.
- `[thea 2]`: Between songs? Somebody's getting up on that stage to sing. Not me. You? No. Somebody.

### Vera — at the tables

- `[vera 1]`: Looking for a chair? There's one at every table and room at all of them.

### Hal — the queue for the one bathroom

- `[hal 1]`: The line? One bathroom's out of order, so we all wait on the other one. It's a good spot to meet people.

### Teo — at the bar

- `[teo-bel 1]`: Tonight? Best night of the year. We come every year.

### Birdie — at the bar

- `[birdie-bel 1]` requires `hasTie`: The bow tie. Told you that blazer wanted something at the neck.
- `[birdie-bel 2]`: Your outfit? It still wants something at the neck. Next year.

---

## The yard (`letIn`)

> On first entering: Out back, the music comes through the wall at half
> volume. A fire, a ring of stools, and three people who came out for air.

### Noor — by the fire

- `[noor 1]`: Do you smell a skunk? / Every night about this time. It's the Catskills.

### Kit — on a stool

- `[kit 1]` requires `done`: Staying a while? Good. The fire's good till two.
- `[kit 2]`: The fire? It takes a log whenever anybody remembers. There's a pile right there. Nobody's remembered in a while.

### Linnea — by the woodpile

- `[linnea-yard 1]` requires `done`: That hill I wouldn't walk up? It doesn't look like anything now.
- `[linnea-yard 2]`: Inside? I'm fine. Better than fine. Somebody's already asked me to trivia night on Thursday.

### Gus — on the next stool

- `[gus-yard 1]` requires `done`: Ray. Stay as long as you like.
- `[gus-yard 2]` requires `sangIn`: Off the door at last. Everybody who's coming is in. And you sang your way in, first time up the hill. / You're alright, you know, Ray. It says so on your shirt. → `done`, toast: Episode complete
- `[gus-yard 3]`: Off the door at last. Everybody who's coming is in. / You're alright, you know, Ray. → `done`, toast: Episode complete

### The fire and the woodpile — as built

- Woodpile: You take a split log off the pile. Dry, and lighter than it looks.
- Fire: You set the log on the fire and it catches. / Everybody round the ring leans back an inch, and somebody says thanks without looking up.
