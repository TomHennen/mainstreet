# Receiving art: the runbook

How a piece of art goes from a contributor's submission to a painted building
in the game. Written so Tom can say "here's a submission" and an agent does the
rest. The standing GitHub issue for this work is #27; every art PR references
it and its branch is `agent/27/<building>`.

## Where submissions arrive

Pressing **Send it to the town** in the Studio opens the Google Form named in
the world pack (`submit.art` in `world.json`), in a new tab, prefilled — the
painter presses Submit there themselves, on Google's own page, so submissions
appear as rows in that form's responses sheet: building id, world id, the
credit name, the `MSA1|…` code, and anything the painter wanted to say. Tom
pastes the row's code here exactly as he used to paste an email. Nothing else
changes — the code is the same code, and `decode-art` reads it the same way.

A large, finished-size drawing makes too long a link to prefill reliably, so
the Studio leaves the code out of it and has the painter copy it instead —
those arrive as a code pasted into the form's own "code" box by the artist,
rather than one the link carried in for them. They read exactly the same way.

Email still arrives too, and is just as welcome: the Studio offers the address
under "Didn't go through?", anyone painting in another app emails their PNG,
and a world pack with no form in it sends by email as before.

## What Tom sends

Any of these is enough:

- The row from the form's sheet, pasted — the `MSA1|…` code and the name the
  person asked to be credited as.
- The email forwarded or pasted, including the `MSA1|…` line, and the credit
  name.
- A PNG the person attached, plus the building id (or its name) and the
  credit name.
- Several of the above at once; do one PR per contributor.

The Studio also lets the artist say which column the door and the little
plaque go in. When they have moved either one, the code ends in a sixth part
like `|door=2,plaque=3`, and an emailed submission carries the same thing in
words. Those
are tile columns across the front of the building, counting from 0 at its left
edge. `decode-art` moves the tiles for you; you never work them out by hand.

If the credit name is missing, ask Tom rather than guessing. Credit exactly
the name given, spelled as given. First name only is fine.

## What the agent does

1. `rein declare 27 --repo TomHennen/mainstreet` (Tom approves on his
   terminal), then a branch from `main` named `agent/27/<building>`.
2. Save the submission — the sheet row, or the email text — to the scratchpad
   and run
   ```
   npm run decode-art -- path/to/submission.txt --credit "Their Name"
   ```
   It finds the `MSA1|` line, checks the building exists and the size fits
   the footprint, writes `worlds/<id>/assets/buildings/<building>.png`, adds
   the credit to `worlds/<id>/credits.json`, and runs validate-assets. Add
   `--force` only when Tom says a repaint replaces the old one.

   If the code carries door and plaque columns, it also writes `door` and
   `plaque` into every placement of that building in `worlds/<id>/world.json`,
   and runs the world past `engine/validate.ts` first — a door or a plaque
   that would land on a solid tile is refused, and nothing is written at all.
   If that happens, tell Tom in plain words which column would not work and
   which ones would, so he can pass it back kindly; never quietly move it
   somewhere else on their behalf.

   Someone can also say where the door goes in words — in the form's "anything
   you'd like to say with it" box, or in an email — rather than in the code:
   "the door should be on the left-hand side", say. Pass it
   on with `--door <col>` and `--plaque <col>`, counting from 0 at the
   building's left edge, so the left-most column is `--door 0` and "third
   column along" is `--door 2`. If the code already says something different,
   the script stops and asks rather than guessing.

   For an attached PNG instead of a code: copy it to the same path, add the
   credit to `credits.json` by hand (`"buildings": { "<building>": "Their
   Name" }` for a first painting; an array of names in order of contribution,
   e.g. `["Tom", "Lana"]`, for a repaint that already has one), and run
   `npm run validate-assets`. If they asked for the door
   somewhere in particular, set `door` and `plaque` on every placement of that
   building in `world.json` by hand — both tiles are `[pos[0] + column,
   pos[1] + size[1]]`, the row just below the footprint — and run
   `npm run validate-episodes` after. If validation fails on size or palette,
   do not fix the art yourself; tell Tom what failed in plain words so he can
   pass it back kindly.
3. Look at the PNG with the Read tool. Check the kindness rule (CLAUDE.md hard
   rule 5 and 6): no pasted logo or trademark, nothing unkind about the place
   or anyone in it, nothing that depicts a private person. If in doubt, stop
   and ask Tom; never merge doubtful art.
4. Run `npm run playtest` and read the screenshot of that building if the
   harness passes it (or take one): the facade should sit on its footprint
   with the extra rows above, the door should be where they painted it, and
   the plaque beside it should thank the painter by name rather than carry the
   unpainted invitation. (The plaque is read from the tile beside the door;
   the sign at the door itself stays the episode's copy either way.)
5. Commit the PNG, `credits.json`, and `world.json` if the door or the plaque
   moved — nothing else — message "Paint <Building Name>
   (art by <Their Name>)" with the usual trailer. Push, open the PR with a
   one-line heads-up naming the building and the contributor, wait for CI
   (validate-assets runs there too), merge. The building is live on the
   next Pages deploy; tell Tom the URL so he can reply to the contributor.

## Repaints, removals and credit changes

- A better version of an already painted building: same steps with
  `--force`. `decode-art` handles the credit itself: `--credit "Their Name"`
  is *appended* to whoever is already on the plaque, in the order they
  painted ("Tom" becomes "Tom and Lana", then "Tom, Lana and Alice"), unless
  that name is on the list already — nothing to add, so nothing changes — and
  it prints the credit as it now reads, so check that line before opening the
  PR. Ask Tom which credit to show only if the touch-up genuinely replaces
  the earlier painting rather than building on it; pass `--replace-credit`
  alongside `--force` to start the credit over with just the new name instead
  of growing the list.
- A touch-up made from the Studio's "Improve it?" — offered both on a
  painted building's plaque in the game and as a button in the Studio itself,
  and either way loads the shipped painting back onto the canvas as real
  pixels to edit, rather than starting from the placeholder guide — arrives
  exactly like any other submission: a full facade code (or PNG), same steps
  with `--force`. There is nothing in the code or the email that marks it as
  a touch-up rather than a repaint from scratch, but the append-by-default
  behavior above means the ordinary case (crediting everyone who worked on
  it) needs nothing extra from you.
- Someone asks to change or remove their credit or their art: do it in one
  PR, no questions asked, and say so in the PR body.

## Receiving a story idea

Story ideas arrive the same way art does — by email, from the suggestion box
outside Jefferson Town Hall in the game, from the front page, or from
CONTRIBUTING.md. They are not art submissions and do not go through
`decode-art`, but they get the same welcome. The standing GitHub issue for
them is #36 (Studio and contributing).

1. Say thank you first. Tom replies to the person; the agent's job is to make
   that easy by summarising what they sent in a sentence or two, in their own
   words wherever possible.
2. Note it on issue #36 as a comment: who sent it, what the idea is, and the
   credit name they asked for. That is the whole record for a small idea — a
   line of lore, a nicer word for a sign, a shop that has moved.
3. Open a dedicated issue only when it is really an episode: a story with a
   village, a person and something that happens. Link it back to the #36
   comment.
4. Check it against the hard rules before it goes anywhere near an episode
   (CLAUDE.md 5 and 6). A real private person appears only with their own
   say-so, in writing, and a real business appears by name with affection and
   nothing else — no gentle knocks, no jokes at anyone's expense. If an idea
   would need softening to ship, say so kindly and ask the sender rather than
   quietly rewriting them out of it.
5. Facts about the real villages that come in alongside an idea — what is on
   which corner, what a place is really called — belong in
   `docs/route10-notes.md`, whether or not the idea itself is ever used.
6. When an idea actually ships in an episode, credit it: the person is named
   on the site's front page under the town they wrote for, the way a painter
   is. Credit story exactly as art is credited — the name given, spelled as
   given, first name only if that is what they asked for. Ask Tom if the
   credit name is missing rather than guessing.

Someone asking to change or remove their credit, or to withdraw an idea, is
done in one PR, no questions asked — same as art.
