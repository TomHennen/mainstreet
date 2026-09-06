Painted art for Route 10 drops in under this folder by convention — see
README.md at the repo root for the full "Adding art" table. Missing files
fall back to engine-built placeholders (buildings/, chars/, portraits/,
tiles/ each carry their own README with size and layout details).

Palette
-------
../palette.png is the fixed palette every PNG under assets/ must draw from
(DESIGN.md §4; enforced by `npm run validate-assets`). It is the "Resurrect
64" palette:

  Name:    Resurrect 64
  Author:  Kerrie Lake
  Source:  https://lospec.com/palette-list/resurrect-64
  File:    downloaded as the "PNG Image (1x)" variant
           (https://lospec.com/palette-list/resurrect-64-1x.png), which is
           already one pixel per swatch (64x1), so no downsampling was
           needed. Pixel colours were checked against Lospec's own
           resurrect-64.json colour list and match exactly.
  License: Lospec's palette page for Resurrect 64 does not display a stated
           license or usage terms (no license field, no separate terms
           text) — only "Created by Kerrie Lake" and a tag list. Lospec's
           general download prompt says the palette can be downloaded "for
           free as a PNG, PAL, ASE, TXT, GPL or HEX file," but that is not a
           license grant. Route 10 is using it under that free-download
           invitation; if a firmer license is ever needed, ask Kerrie Lake
           directly or swap in DESIGN.md's planned custom Catskills palette
           (§4, §7 M3).

This is a placeholder palette per DESIGN.md §4 ("Route 10 starts with
Resurrect 64 until a custom Catskills palette is commissioned").
