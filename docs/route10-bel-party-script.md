# What's the Word — draft script

Every line a player can read in the Belvedere party episode, in the order
the engine would evaluate it, tagged `[speaker N]` so a note can point at
one. Hand-written ahead of the JSON (the engine features it needs — NPC
`requires`, `wardrobe`, `music`, `choices` — are not built yet, so there is
nothing for `episode-script` to print). When the JSON exists this file goes
away and the printed script replaces it. Treatment and decisions:
`docs/route10-bel-party.md`. Rules: `docs/writing-episodes.md`.

Entries are first-match: the first whose `requires` all hold is the one
said. `→` marks an effect.

Flags: `heardAsk`, `askedMarnie`, `hasJacket`, `hasShirt`, `hasTie`,
`metTBcv`, `metTBrec`, `partyOn`, `saidWord`, `sangIn`, `letIn`, `done`.

---

## Intro

> The board outside the Bel says SATURDAY. YOU KNOW. You don't. Earl, out
> front of Stewart's, probably does.

## Small talk (ambient walkers, all week)

1. Saturday? I'm not supposed to say.
2. I went up last year in my work boots and Gus had me dance in my socks.
3. The paper's off that window under the coffee shop. Records, of all things.
4. The honey wagon was up our road this morning. Half the street came out to watch.
5. Everybody's got the word except the one person who gives it out. No, hang on. That's backwards.
6. My jacket's been hanging on the door since Tuesday so I don't forget.
7. Marnie's been up a ladder all week. Says she hasn't. She has.
8. Somebody said the word out loud in the bread aisle at Tops. Whole aisle went quiet.
9. Nice enough evening for a walk up a hill.
10. If you hear singing from up Academy Street later, that's normal.
11. Wren's been carrying speakers up that hill since noon.

## Overlays and props

- **Board by the Bel's door** (all week): A chalkboard on the walk, one line, careful capitals: SATURDAY. YOU KNOW.
- **The sharpie wall**, added this week: Fresh among the drawings, in a careful hand: a truck with a big tank on the back and a hose off the side. Under it, THIS YEAR.
- **The stairwell on the deck** (all week, replaces ep002's): The paper's off the little window and the plywood's gone. Stairs go down under the coffee shop, and there's music coming up them.
- **Mill Pond Inn, at the door**: The hook by the door: a dog lead, a scarf nobody's claimed, and a note in pen. TOOK MY HAT BACK. D.

---

## Stamford, by day and night

### Earl — outside Stewart's

- `[earl 1]` requires `done`: Last night up at the Bel? I heard the singing from here. Good night, that was.
- `[earl 2]` requires `partyOn`: Dressed for it, I see. Go on up. The word's lantern, remember.
- `[earl 3]` requires `heardAsk`: Lantern. That's the word. I'd write it down if I were you.
- `[earl 4]`: The Bel? Saturday's a speakeasy night. Marnie's rule: the word at the door, and you don't come in what you wore to work. / The word's lantern. You didn't get it from me. → `heardAsk`

### Linnea — foot of Academy Street (gone once `letIn`)

- `[linnea 1]` requires `partyOn`: You've been in? And it's alright in there? / Okay. Okay. I'll come up behind you.
- `[linnea 2]`: That building? Is that really where everyone's going? It looks like it's leaning.

---

## The Bel by day (before `partyOn`)

### Marnie — behind the bar (all week)

- `[marnie 1]` requires `done`: Last night? Best one we've had. Same time next year, different word.
- `[marnie 2]` requires `letIn`, `sangIn`: You sang? Good. Better than the word, honestly.
- `[marnie 3]` requires `letIn`, `saidWord`: Honey wagon, at the door? Gus came and told me. Nobody's ever asked me for it. I could've hugged you.
- `[marnie 4]` requires `askedMarnie`: The word? Still honey wagon. Don't wear it out.
- `[marnie 5]` requires `heardAsk`: The word? Honey wagon. If Earl's given you lantern, that was last year's. He does that every year, bless him. → `askedMarnie`
- `[marnie 6]`: The word? Honey wagon. Don't write it on the wall. That's how last year's got out. → `askedMarnie`

### Gus — at the foosball (gone once `partyOn`)

- `[gus-day 1]`: This table? I've been beating myself at it since March. Come back when it's dark.

### Wren — on the stage (gone once `partyOn`)

- `[wren-day 1]`: Sound check. Come back when it's dark. This is going to be a different room.

---

## Core Values

### Oda — the counter

- `[oda 1]` requires `hasJacket`: The blazer? It's yours. Bring it back Monday, or don't.
- `[oda 2]` requires `hasShirt`: Something for Saturday? That rack by the door. Half of Stamford's been through it. / The green one. Velvet. It's been waiting for somebody your size all week. Take it. / It's getting on. Whatever's happening up the hill is happening soon. → hands over **the green velvet blazer**, `hasJacket`, `partyOn`
- `[oda 3]`: Something for Saturday? That rack by the door. Half of Stamford's been through it. / The green one. Velvet. It's been waiting for somebody your size all week. Take it. → hands over **the green velvet blazer**, `hasJacket`

### Teo — at the rack

- `[teo-cv 1]` requires `metTBrec`: Oh — hello again. We do get around. → `metTBcv`
- `[teo-cv 2]`: The rack? Everything good on it has been through our hands twice. → `metTBcv`

### Birdie — at the rack

- `[birdie-cv 1]` requires `hasShirt`: That shirt? Ray's, whoever Ray was. It wants a jacket over it and something at the neck. Renata at Cellar Door wore a velvet bow tie to the opening under the coffee shop, and there's been a very good hat on the hook at Mill Pond Inn since pizza night.
- `[birdie-cv 2]`: Core Values? Thirty years, and I've never once left without a book.

### Props

- **The rack by the door**: A rail of jackets and shirts pulled round by the door, with a card on it: FOR SATURDAY. Half of it's gone already.
- **The shelves**: Thirty years of people bringing things in and taking things out. Kitchen things, coats, a shelf of books that changes every week.

---

## The record shop under Stamford Coffee

### Bram — unpacking boxes

- `[bram 1]` requires `hasShirt`: The shirt? Ray's, whoever he was. Wear it well.
- `[bram 2]` requires `hasJacket`: Clothes? The rail's for sale too, once I find the tags. / That bowling shirt, RAY over the pocket. Take it. It's your size. / It's getting on. Whatever's happening up the hill is happening soon. → hands over **Ray's bowling shirt**, `hasShirt`, `partyOn`
- `[bram 3]`: Clothes? The rail's for sale too, once I find the tags. / That bowling shirt, RAY over the pocket. Take it. It's your size. → hands over **Ray's bowling shirt**, `hasShirt`

### Teo — at the rail

- `[teo-rec 1]` requires `metTBcv`: Oh — hello again. We do get around. → `metTBrec`
- `[teo-rec 2]`: The rail? Start at the left. We've been through the right half already. → `metTBrec`

### Birdie — at the rail

- `[birdie-rec 1]` requires `hasJacket`: That blazer? We saw it Tuesday and left it for somebody. Glad it was you. It wants something at the neck. Renata at Cellar Door wore a velvet bow tie to the opening here, and there's been a very good hat on the hook at Mill Pond Inn since pizza night.
- `[birdie-rec 2]`: This place? Open two days and it already smells like a record shop.

### Props

- **The crates**: LPs in crates, sorted by nothing yet. A handwritten card says BROWSE, WE'LL FIGURE OUT THE ORDER LATER.
- **The wall**: Album covers going up one at a time, a hammer on the floor under the next gap.
- **Where the sign goes**: A nail by the door with nothing on it. Taped under it: SIGN'S ON ORDER.

### Two who guessed wrong (ep002's rumour, one line each)

- `[fern 1]` (Stamford Coffee): Downstairs? Records. I said gallery. There are album covers on the wall, so I'm counting it.
- `[ozzie 1]` (80 Main): Downstairs? Records. I'd have been happy with oysters.

---

## Out of town

### Renata — Cellar Door Wines, Hobart

- `[renata 1]` requires `done`: Last night at the Bel? I heard it went late.
- `[renata 2]` requires `hasTie`: The tie? It suits you better than it did me.
- `[renata 3]`: The bow tie? Wore it to the record shop's opening. Velvet. It's had its night. Take it. → hands over **Renata's velvet bow tie**, `hasTie`

### Dot — outside Middle Brook Cafe, Jefferson

- `[dot 1]` requires `done`: The Bel last night? Even up here we heard about it.
- `[dot 2]`: My hat? It sat on that hook at the Mill Pond a month before I remembered it. You'll do fine without.

---

## Night falls (scene, on `partyOn`)

> toast: The light's going off the hills.
> light: dim, kept.

---

## The Bel by night (`partyOn`)

### Gus — inside the door (gone once `letIn`)

- `[gus-door 1]`: What's the word?
  - **Honey wagon** → Honey wagon? Nobody's said honey wagon all night. Who gave you that? / Marnie? Marnie doesn't tell anyone. / She did? Well. You're alright, then. Evening, Ray. → `saidWord`
  - **Lantern** → Lantern. Last year's. Earl? Thought so. / House rule, then. → `sangIn`
  - **Utsayantha** → Utsayantha. That's the mountain. Good guess. / House rule. → `sangIn`
  - **I don't have it** → Nobody does, first time. / House rule. → `sangIn`

### Scene: the right word (on `saidWord`)

> light: party, over the stage. music: up.
> camera follows Wren onto the stage, a beat, back to the player.
> Gus, to whoever is behind you: Lantern. Yep. Earl. In you go.
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
- `[wren 2]`: This crate? Half of it came up those stairs under the coffee shop.

### Thea — by the stage

- `[thea 1]` requires `sangIn`: You again? You've had your turn. Somebody else. Linnea, come here.
- `[thea 2]`: Between sets? Somebody's getting up there. Not me. You? No. Somebody.

### Vera — at the tables

- `[vera 1]`: A chair? There's one at every table and room at all of them.

### Hal — the queue for the one bathroom

- `[hal 1]`: The queue? It's the one bathroom. Lantern gets you the other door.

### Teo — at the bar

- `[teo-bel 1]`: Tonight? Best night of the year. We come every year.

### Birdie — at the bar

- `[birdie-bel 1]` requires `hasTie`: The bow tie. Told you it wanted something at the neck.
- `[birdie-bel 2]`: Your outfit? Still wants something at the neck. Next year.

---

## The yard (`letIn`)

> On entering: music, low, through the wall.

### Noor — by the fire

- `[noor 1]`: Do you smell a skunk? / Every night about this time. It's the Catskills.

### Kit — on a stool

- `[kit 1]` requires `done`: Staying? Good. The fire's good till two.
- `[kit 2]`: The fire? It takes a log whenever anybody remembers. Nobody's remembered in a while.

### Linnea — by the woodpile

- `[linnea-yard 1]` requires `done`: The hill? It doesn't look like anything now.
- `[linnea-yard 2]`: Inside? I'm fine. Somebody's already asked me to trivia on Thursday.

### Gus — on the next stool

- `[gus-yard 1]` requires `done`: Ray. Stay as long as you like.
- `[gus-yard 2]` requires `sangIn`: Off the door at last. Everybody who's coming is in. And you, singing your way in first time up. / You're alright, you know, Ray. → `done`, toast: Episode complete
- `[gus-yard 3]`: Off the door at last. Everybody who's coming is in. / You're alright, you know, Ray. → `done`, toast: Episode complete

### The fire and the woodpile — as built

- Woodpile: You take a split log off the pile. Dry, and lighter than it looks.
- Fire: You set the log on the fire and it catches. / Everybody round the ring leans back an inch, and somebody says thanks without looking up.
