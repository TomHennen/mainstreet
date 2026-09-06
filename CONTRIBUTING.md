# Contributing art to Route 10

Route 10 is a little pixel-art game about Jefferson, Stamford, and Hobart —
meant to be painted by the people who actually live there. You don't need
to know how to code.

## What we're looking for

Right now, most of all: **building facades.** Every real business and
landmark starts as a plain placeholder box with its name on it, waiting for
someone who knows what it looks like to paint it in. See the list below for
what's still open.

Later we'll also want people — character sheets and portraits — but facades
come first, since they're what makes each village recognizably itself.

## How to paint one

Easiest: the in-browser **Studio**, which locks the canvas size and color
palette for you, so there's nothing to get wrong.

<https://tomhennen.github.io/mainstreet/studio/>

Pick the building you want, and it sets you up with a correctly-sized,
correctly-paletted canvas to draw on.

If you'd rather use a "real" pixel art tool, **Aseprite** (paid) or
**Piskel** (free, in-browser) both work — just follow the spec below by
hand.

## The spec in plain words

- Everything sits on a **16×16 pixel grid** — like building out of little
  square bricks.
- Save as a **PNG** with a transparent background.
- **No smoothing or anti-aliasing** — turn it off if your tool defaults to
  it. Pixel art wants hard, clean edges.
- Use **only the colors in the game's palette.** The Studio locks this for
  you; in Aseprite or Piskel, load the palette file first and pick from it.
- **Width** = the building's footprint width in tiles, times 16 pixels.
- **Height** is a multiple of 16, and can be taller than the footprint —
  the art sits on the bottom of the canvas, and any extra rows above are
  where a roof, awning, or hanging sign goes.

Exact sizes for every open building are below.

## How to send it

The Studio's **Submit** button opens an email to
**tom.hennen+mainstreet@gmail.com** with a text code of your drawing
already in the body — just hit send.

Painted outside the Studio? Email that same address and attach the PNG.

Either way, include **the name you'd like credited.** We may nudge colors
or proportions slightly to fit, asking first for anything big — and your
name goes up as the painter regardless.

## The kindness rule

Real businesses and places are drawn with the same affection we'd want for
our own storefront:

- No pasting in real logos or trademarked signage — paint your own take on
  the place instead.
- No real private people appear without their own say-so first.
- Keep it warm. If in doubt, make it kinder.

## Licenses

- The game's code is Apache 2.0 — see [`LICENSE`](LICENSE).
- Art and world content, including everything you contribute, is Creative
  Commons Attribution 4.0 — see [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md).
  In short: anyone may copy, share, adapt and use it, commercially too, as
  long as they credit the creator — exactly what the in-game "painted by
  ___" credit and `credits.json` are for.

## Buildings waiting for an artist

None of Route 10's buildings are painted yet — every one below is still a
placeholder box, and any of them is up for grabs:

| Building | Village | Size (pixels) |
| --- | --- | --- |
| Jefferson Town Hall (`jefferson-town-hall`) | Jefferson | 80 × 48 |
| Mill Pond Inn (`mill-pond-inn`) | Jefferson | 80 × 48 |
| Heartbreak Hotel (`heartbreak-hotel`) | Jefferson | 80 × 48 |
| Middle Brook Cafe (`middle-brook-cafe`) | Jefferson | 80 × 48 |
| Stewart's (`stewarts`) | Stamford | 96 × 64 |
| Mac-A-Doodles (`mac-a-doodles`) | Stamford | 64 × 48 |
| Stamford Coffee (`stamford-coffee`) | Stamford | 80 × 48 |
| The Belvedere (`the-belvedere`) | Stamford | 80 × 48 |
| Cellar Door Wines (`cellar-door-wines`) | Hobart | 80 × 48 |

These are minimums — width is fixed by the footprint, but add extra rows
above for a roofline, sign, or anything that makes it feel like the real
place.

---

If you want to work on the code instead, start with [`CLAUDE.md`](CLAUDE.md).
