# Writing an episode

What we learned building episode 2 ("Anybody Headed Down Today?",
September 2026). It took three story treatments, an engine feature or
two, and four rounds of copy notes from Tom on a printed script before
the dialogue was right. Most of that back and forth was the same handful
of mistakes, so here they are as rules. Read this before writing or
reviewing any episode; `DESIGN.md` §3 is the schema, this is the craft.

## How the player experiences a line

The player never sees their own side of a conversation. They walk up,
press A, and the character speaks. So:

- **Every entry opens by naming what it is answering.** Not "Battery's
  dead." but "The truck? Battery's dead." Not "Good. He'll be glad of
  you." but "You found cables? Good." A line that assumes the player just
  asked a specific question reads as a non sequitur, because they didn't.
- **Every state needs a line that stands alone.** Entries are matched
  first-match by `requires`, and a player can meet anyone in any order.
  Write the `done` line for someone the player may never have met (no
  "like I said"), and the early line for someone they met too soon.
- **Introduce every named thing.** "Biscuit likes to check the patio" is
  a puzzle until "This is Biscuit."
- **No tails.** "He's the one." "I've looked anyway." "That's all it ever
  was." If a sentence exists to round the line off, cut it.

## Don't hand the player the answer

- **The intro hooks and points at a person or a place, never at the
  problem.** Episode 1: flyers in every window, Earl will know the story.
  Episode 2: Priya on the deck checking her phone. Not "Priya needs a
  costume driven to the city and Walt drives down on Sundays."
- **Nobody says who to see next.** "Walt's the one." "Jess T. is who you
  want." "Try the coffee shop." Those are arrows; a player following
  arrows isn't playing. A character says what they know and the player
  works out where that leads. The errand itself is the only pointer the
  episode gets.
- **Let the player discover the joke.** Walt says "Jess usually helps
  me out." He does not say there are four of them. The player asks a
  Jess, gets the wrong one, and finds out. If a character announces the
  premise, there is nothing left to notice.
- **Nobody explains mechanics.** Not how a jump works, not that cables
  need a second car, not twice. If the player needs one fact, one
  character says it once.

## Jokes

The jokes don't land when a line is written to be clever. What lands is
a situation: four people named Jess and a man who never asks the right
one first; three neighbours each certain the mystery shop is something
different; a dog who inspects the patio. Write the situation, then write
plain lines around it.

Cut on sight: symmetrical constructions ("including the counter, and the
counter knows everything"), a character commenting on being a character
("nice day for standing on Main Street, which is what I'm doing"), stock
phrases ("slow and easy"), and any wink at the game itself. A joke is
aired once, by the person it belongs to. Walt makes the four-Jesses joke;
Hannah and the small talk do not repeat it.

## Register

Plain, specific, one thought per line, the way people in a Catskills
village talk. Priya is steady, not flustered. Walt is dry and practical.
The Jesses are distinct but ordinary. If a line could be read aloud on a
porch without anyone noticing it was written, it's right. "And he can
breathe" is not.

Don't anchor on numbers ("ten minutes" appeared five times). Don't
mention the same rumour in every mouth; twice is texture, five times is a
dead horse. Don't invent geography: there is no river at J&H, and NY 10
has no sidewalk to point at.

## Real places and real people

- Real businesses appear warmly and truthfully. Check
  `docs/route10-notes.md` for facts (Mill Pond's pizza night is
  Wednesdays; J&H has a deli counter) before writing one down.
- No fluff at a real place either. "He can sit at J&H all day and they'll
  bring him coffee" was cut for being annoying, not for being unkind.
- Always-on world copy (getting lost, road ends, signs) must never name an
  episode character. A deputy who says "Renata's inside" points at an
  empty shop on any other week.
- Tom's standing exceptions to the be-nice rule are listed in
  `CLAUDE.md`; don't add to them without his word.
- **Locals' names for places are fine in dialogue.** The Belvedere is
  "the Bel" in every mouth in Stamford, and a character who says "the
  Belvedere" sounds like a visitor. The players live here too; they can
  work out that the Bel is the building with THE BELVEDERE over the door.
  Narration (the intro card, a sign) may use the full name once; people
  don't. (Tom, Sep 2026.)

## Structure

- **The first stop tells the truth.** Walt says his battery's dead and
  what he needs on the first visit. Nothing withholds "for the game"; if
  the episode is held shut, it's held by the world (no cables in
  Jefferson), not by a character stonewalling.
- **Each stop reveals something usable**, a clue the player reasons with,
  not a name to walk to. Two load-bearing stops are enough; the rest are
  colour.
- **Put the helper away from the asker.** Priya stood next door to the
  only man who could drive her bag down; she moved to Stamford so the
  errand crosses the map. Use all three villages when you can.
- **Characters stand still.** An episode NPC is on their tile from frame
  one and can't leave except inside a scene. If someone must go, give
  them `until: "<flag>"` (they vanish when it's set) and stage the going.
- **Hand-overs are items.** A dialogue entry with `"item": "<id>"` puts
  a carried-only item in the "With you" panel; `until` takes it off again
  when the flag that means "delivered" is set. The bag should leave the
  panel when Walt takes it, not when the truck leaves.
- **Ambient walkers can carry an episode** by sharing their id (the four
  Jesses are the four village walkers); they stand still for the week,
  so keep `smallTalk` at eight lines or more for the validator.

## Scenes

- **No dead air.** Anything the player can't see is time they're
  waiting. Have the camera follow the actor (`"camera": { "to":
  "npc:<id>" }`), make something move in the first second, hand the
  camera back to the player before a long drive, and halve every `wait`
  you wrote by instinct.
- **Stage in the right lanes.** Row 16 in Stamford is westbound, row 18
  eastbound; a truck driving against traffic looks wrong and stalls
  behind the ambient car. Check the lanes on each map before writing a
  vehicle path.
- **Vehicles in scenes go first in the map's `vehicles` list** so ambient
  cars yield to them, and a parked car that must move must not be sitting
  within two tiles of another parked car's nose (it will be braking
  before the scene begins).
- **End on something.** The completion toast is easy to miss under a
  scene; put a closing line from whoever is left ("There he goes.")
  right before it, and make sure the truck leaves with the driver in it.

## How to review

Don't play it. Print it:

```
npm run episode-script -- route10 ep002 --out /tmp/ep002-script.md
```

That is every line in the order the engine evaluates it, tagged
`[walt 3]` so notes can point at an entry. Tom marks lines with `!!`; the
writer edits the JSON; the script regenerates in a second;
`npm run validate-episodes` checks structure. Play it once at the end for
pacing, on the dev channel, which rebuilds two minutes after a merge.

For a story rework, write two or three treatments first (a diagnosis, a
beat table per treatment, what changes in the JSON, the risks against
the hard rules) and let Tom pick. Then write. Then a critic reads the
whole file as a player would, with one specific brief: quote every line
that sounds written by a model and give the plain version. Expect that
pass to find things; it always does.
