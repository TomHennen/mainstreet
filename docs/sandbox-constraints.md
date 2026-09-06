# Sandbox constraints

What the rein sandbox lets an agent session do in this repo, and what it still
cannot. Updated 2026-09-06 after the egress allowlist was widened.

## Works now

- **npm registry is reachable.** `npm install`, `npm view`, `tsc`, `vite build`
  and `vite dev` all run inside the sandbox. Dependency versions are verified,
  not guessed. Caches start cold each run (`$HOME` is ephemeral) so every session
  re-downloads the tree; at ~20 packages that is a few seconds.
- `git` and `gh` reads. Writes unlock after `rein declare <n> --repo TomHennen/mainstreet`
  is approved on Tom's terminal; pushes then go to `agent/<n>/<nonce>` only.

## Still blocked

- **No browser.** Playwright and Puppeteer install from npm, but their browser
  binaries come from hosts outside the allowlist, so headless Chromium cannot be
  installed:

  ```
  cdn.playwright.dev                        blocked
  playwright.download.prss.microsoft.com    blocked
  storage.googleapis.com                    blocked   (puppeteer)
  ```

  To unblock, on the host: `rein session allow-domain cdn.playwright.dev`
  (and `playwright.download.prss.microsoft.com` as its fallback), then restart
  rein. With that, an agent can run the game headless, screenshot it, and drive
  ep000 end to end. Until then "does it feel right" is answered only by Tom's
  `npm run dev`.
- Every other host: Phaser docs, Tiled downloads, the Resurrect 64 palette PNG.

## Filesystem

- Only the working tree at `/mnt/dev/dev/mainstreet` survives a run.
- `$HOME` writes succeed and are discarded at the end of the run.
