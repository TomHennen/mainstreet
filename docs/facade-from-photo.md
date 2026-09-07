# Making a facade from a photo with an agent

A prompt to paste into any Claude session that can read images and run
code, with two attachments: a photo of the building and
`worlds/route10/palette.png`. Fill in the angle brackets from
`worlds/route10/world.json` (Stewart's is 6 by 4 tiles; most others are
5 by 3; Mac-A-Doodles is 4 by 3).

```
You are a pixel artist working in code. I'm attaching a photo of a real
building. Turn it into a game facade for the mainstreet project.

TARGET
- Building id: <building-id>   (e.g. stewarts)
- Footprint: <W> tiles wide by <H> tiles deep  (e.g. 6 by 4)
- So the PNG is exactly <W*16> px wide. Height is a multiple of 16,
  at least <H*16>; use one or two extra rows of 16 above for the roof,
  fascia or sign. Art is anchored to the bottom of the image.
- The game draws the door at the bottom centre of the footprint, so put
  the entrance there.

RULES (non-negotiable)
- PNG, transparent background, no anti-aliasing: every pixel is fully
  opaque or fully transparent.
- Only the 64 colours in the attached palette.png (64 by 1, index = x).
  Pick the nearest palette colour for every real-world colour.
- Hard pixel edges, light from the upper left. It will be shown at 2x
  and 3x zoom, so anything thinner than 1 px or smaller than 3 px wide
  will not read.
- Do not copy a logo, brand lettering or trademarked signage. Suggest a
  sign with a plain panel or a couple of pixels; never spell the brand.
- Draw the place with affection.

STEP 1: READ THE PHOTO
Write down, in a list, only what a pixel artist needs: overall shape
(storeys, width to height), wall colour and material, roof or fascia
colour and how tall it is relative to the wall, number and shape of
windows and where they sit, door type and position, awnings, signs,
steps, planters, anything on the sidewalk in front (newspaper box,
bench, sandwich board), and the two or three details that make it
recognisable to a local. Ignore cars, people, sky and trees.

STEP 2: PLAN ON THE GRID
Sketch the layout as a table of rectangles in pixel coordinates on the
<W*16> by <height> canvas: fascia band, wall, each window, the door,
the sign panel, the base. Check the proportions against the photo and
adjust before drawing anything.

STEP 3: BUILD IT IN CODE
Write a script with small helpers (rect, outlinedRect, line, a simple
checker dither) that paints the rectangles from the plan with named
palette colours, then encodes a PNG. Also write an 8x nearest-neighbour
upscale so you can look at it.

STEP 4: LOOK AND ITERATE (at least three rounds)
View the upscale. Ask: does it read as this building at a glance? Is
the fascia too tall? Do the windows read at 2x? Is there one shadow
line under the fascia and one highlight on the glass? Fix, re-render,
look again. Stop when a local would say "that's the place".

STEP 5: VALIDATE
Every opaque pixel on-palette, exact width, height a multiple of 16,
no partial alpha. Say what you checked.

DELIVER
The PNG, the 8x preview, the script, and a five-line note: what the
photo told you, what you simplified, and what you'd improve with more
time.
```

Inside this repo the same job is easier: `scripts/png.ts` encodes the
PNG, `npm run validate-assets` does step 5, and the Studio's Import a PNG
accepts the result for touch-ups before sending. If the agent cannot run
code, steps 1 and 2 alone give a rectangle plan that is most of the work.
