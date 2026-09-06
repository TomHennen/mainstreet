# Sandbox constraints

What the rein sandbox lets an agent session do in this repo. Updated 2026-09-06.

## Works

- **npm registry.** `npm install`, `npm view`, `tsc`, `vite build`, `vite dev`.
- **Headless Chromium.** Playwright's browser download needs three hosts:
  `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, and
  `storage.googleapis.com` (the first redirects Chrome for Testing builds to
  the last). All three are allowed now, so `npx playwright install chromium`
  works and `npm run playtest` can play the game headless under WebGL with
  `--use-angle=swiftshader`. Firefox also installs.
- `git` and `gh` reads. Writes unlock after
  `rein declare <n> --repo TomHennen/mainstreet` is approved on Tom's
  terminal; pushes then go to `agent/<n>/<nonce>` only.

## Still blocked

- Every host not on the allowlist: Phaser docs, Tiled downloads, the
  Resurrect 64 palette PNG. Ask for `rein session allow-domain <host>`;
  it applies on the next run.

## Filesystem

- Only the working tree at `/mnt/dev/dev/mainstreet` survives a run.
- `$HOME` writes succeed and are discarded at the end of the run, so the
  Playwright browser cache (`~/.cache/ms-playwright`, ~200 MB) is
  re-downloaded every session. `node_modules` lives in the working tree
  and persists.
