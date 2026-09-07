Painted car sheets drop in here — see README.md. Missing files fall back to
the engine's own drawn car in the colour world.json asks for.

One file per vehicle id on a map, 32x128: four 32x32 frames stacked in the
same row order as a character sheet — down, left, right, up — and no walk
frames, since a car looks the same standing or moving. The car itself is
about 16x32 inside its square cell, so the same cell holds it lengthways or
across; everything outside it is transparent.
