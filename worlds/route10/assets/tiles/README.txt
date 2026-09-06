route10.json is the Tiled tileset: the tile ids, their kinds and their
`solid` flags. Open it in Tiled to paint the maps in ../../maps/.

route10.png is the sheet it names, and it does not exist yet — until it does,
the engine draws each tile from the `style`/`colors` properties in the JSON.
Drop in a 80x112 PNG (5 columns x 7 rows of 16x16, tile ids left to right, top
to bottom, matching the JSON's order) and it replaces those placeholders.

Other painted art drops in beside this folder — see README.md.
