# Receiving art: the runbook

How a piece of art goes from a contributor's email to a painted building in
the game. Written so Tom can say "here's a submission" and an agent does the
rest. The standing GitHub issue for this work is #27; every art PR references
it and its branch is `agent/27/<building>`.

## What Tom sends

Any of these is enough:

- The email forwarded or pasted, including the `MSA1|…` line the Studio put
  in the body, and the name the person asked to be credited as.
- A PNG the person attached, plus the building id (or its name) and the
  credit name.
- Several of the above at once; do one PR per contributor.

If the credit name is missing, ask Tom rather than guessing. Credit exactly
the name given, spelled as given. First name only is fine.

## What the agent does

1. `rein declare 27 --repo TomHennen/mainstreet` (Tom approves on his
   terminal), then a branch from `main` named `agent/27/<building>`.
2. Save the email text to the scratchpad and run
   ```
   npm run decode-art -- path/to/email.txt --credit "Their Name"
   ```
   It finds the `MSA1|` line, checks the building exists and the size fits
   the footprint, writes `worlds/<id>/assets/buildings/<building>.png`, adds
   the credit to `worlds/<id>/credits.json`, and runs validate-assets. Add
   `--force` only when Tom says a repaint replaces the old one.

   For an attached PNG instead of a code: copy it to the same path, add the
   credit to `credits.json` by hand (`"buildings": { "<building>": "Their
   Name" }`), and run `npm run validate-assets`. If validation fails on size
   or palette, do not fix the art yourself; tell Tom what failed in plain
   words so he can pass it back kindly.
3. Look at the PNG with the Read tool. Check the kindness rule (CLAUDE.md hard
   rule 5 and 6): no pasted logo or trademark, nothing unkind about the place
   or anyone in it, nothing that depicts a private person. If in doubt, stop
   and ask Tom; never merge doubtful art.
4. Run `npm run playtest` and read the screenshot of that building if the
   harness passes it (or take one): the facade should sit on its footprint
   with the extra rows above, and the plaque beside its door should thank the
   painter by name rather than carry the unpainted invitation. (The plaque is
   read from the tile beside the door; the sign at the door itself stays the
   episode's copy either way.)
5. Commit the PNG and `credits.json` only, message "Paint <Building Name>
   (art by <Their Name>)" with the usual trailer. Push, open the PR with a
   one-line heads-up naming the building and the contributor, wait for CI
   (validate-assets runs there too), merge. The building is live on the
   next Pages deploy; tell Tom the URL so he can reply to the contributor.

## Repaints, removals and credit changes

- A better version of an already painted building: same steps with
  `--force`; keep the earlier painter in the PR body so the history shows
  both, and ask Tom which credit line to show if the painters differ.
- Someone asks to change or remove their credit or their art: do it in one
  PR, no questions asked, and say so in the PR body.

## Things that are not art submissions

Story ideas, corrections to a building's position, or "that shop closed"
go to Tom as a note, not into this flow. Map facts belong in
`docs/route10-notes.md`.
