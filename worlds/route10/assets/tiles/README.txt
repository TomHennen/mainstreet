route10.json is the Tiled tileset: the tile ids, their kinds and their
`solid` flags. Open it in Tiled to paint the maps in ../../maps/.

route10.png is the sheet it names, and it does not exist yet — until it does,
the engine draws each tile from the `style`/`colors` properties in the JSON.
Drop in a 80x176 PNG (5 columns x 11 rows of 16x16, tile ids left to right, top
to bottom, matching the JSON's order) and it replaces those placeholders. The
first 54 slots are used; the last one is spare.

The tiles, in id order: three grasses, two flower patches, sandy road plain and
worn, water plain and rippled, a tree, a bench, two interior floors, a doormat,
two walls, a counter, three shelves, two coolers, a steel bar counter, a fourth
shelf, a third floor, asphalt plain, worn, and with a yellow centre-line dash
across and along, a bridge deck, a flat wall, concrete sidewalk plain and worn,
and then the cafe set: a wooden patio deck, a cafe table, a planter, an herb
bed, asphalt with a white parking-stall stripe, the patio deck again for the
near row (same planks, plus the front face of the deck along the bottom of the
tile), a sun umbrella, and a stone patio in warm grey flagstones: the pavers
plain, and the pavers again for the near row (same stones, plus the front face
of the patio along the bottom of the tile).

Then the indoor set (ids 43-45), for the rooms `scripts/make-room` builds: a
stage floor in dark planks, the same planks again for the stage's near row
(plus the front face of the riser along the bottom of the tile), and a standing
board — a wooden frame round a dark green face, for a chalkboard or a menu
propped by the door. All three are solid: they are furniture, walked round
rather than over. A bar top is the wooden counter (id 16) over again, which is
what a bar is.

Then the bar-room set (ids 46-51): a stool (the cafe table's small sibling, a
round seat on one leg, for ringing a counter with); a games table with a sunk
playfield and rods across it, drawn full-cell-width so a table two or three
tiles long reads as one table; a closed door, which fills its cell because it
stands in a wall rather than on the floor; a firepit, a ring of stones round a
warm middle, painted rather than animated; and two wall panels — one papered
over, seams showing, and one covered in small marks in three colours, for a
wall people have drawn on. All six are solid.

Then a second door (id 53): the same door in steel — dark frame, brushed
panel, bright handle — for a kitchen. It is not solid: it is the doorway
itself, the tile the player walks through, laid on the one floor cell of a
dividing wall between two parts of a room (Stamford Coffee's kitchen door)
rather than standing there as furniture.

Anything raised above the ground plane is lit from the top left and keeps its
art in the top 12 pixels of its cell, so a deck's front face still shows below
a table or a planter standing on the near row.

Other painted art drops in beside this folder — see README.md.
