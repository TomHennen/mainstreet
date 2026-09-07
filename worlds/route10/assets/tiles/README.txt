route10.json is the Tiled tileset: the tile ids, their kinds and their
`solid` flags. Open it in Tiled to paint the maps in ../../maps/.

route10.png is the sheet it names, and it does not exist yet — until it does,
the engine draws each tile from the `style`/`colors` properties in the JSON.
Drop in a 80x128 PNG (5 columns x 8 rows of 16x16, tile ids left to right, top
to bottom, matching the JSON's order) and it replaces those placeholders.

The tiles, in id order: three grasses, two flower patches, sandy road plain and
worn, water plain and rippled, a tree, a bench, two interior floors, a doormat,
two walls, a counter, three shelves, two coolers, a steel bar counter, a fourth
shelf, a third floor, asphalt plain, worn, and with a yellow centre-line dash
across and along, a bridge deck, a flat wall, concrete sidewalk plain and worn,
and then the cafe set: a wooden patio deck, a cafe table, a planter, an herb
bed, and asphalt with a white parking-stall stripe.

Other painted art drops in beside this folder — see README.md.
