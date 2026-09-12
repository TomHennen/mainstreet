/**
 * A generic multiplier over elapsed time, used only by the headless playtest
 * harness (`scripts/playtest.mjs`) to exercise identical engine logic in less
 * wall time. It scales two different things by the same factor, so a run at
 * N× plays out exactly like one at 1x, just sooner:
 *
 * - The `delta` each scene feeds its own per-frame movement and countdowns —
 *   walking, NPCs, cars, a scene's `wait` steps, lighting, a held door press,
 *   a car's holler timer — multiplied once, at the top of each scene's own
 *   `update()`.
 * - The literal millisecond durations handed to a real timer or tween
 *   (a travel card's hold and fade, the toast banner, the action/tap/toggle
 *   debounce) — divided by `scaled()`, so they still land at the same
 *   *relative* moment, only sooner in real time.
 *
 * Default 1 everywhere, always — this is settable only through `?timescale=`
 * on the URL, read once at boot (`engine/main.ts`), and through the harness's
 * own `window.__mainstreetSetTimeScale` (also `engine/main.ts`, for dropping
 * to real speed for a moment mid-run — the playtest harness's own
 * `settleOnTile`) — both behind the same `import.meta.env.DEV` guard as the
 * rest of the debug surface (`engine/debug.ts`), so no build a player runs
 * can ever see anything else (DESIGN.md §2). `setTimeScale` itself repeats
 * that guard, so nothing that ends up calling it directly from outside a dev
 * build gets anywhere either.
 *
 * Not everything in the engine reads this, on purpose. The Studio
 * (`studio/studio.ts`) is a separate tool with its own real-time debounces
 * and animations, never imports this module, and was never meant to run any
 * faster than a real contributor's own. The title screen's (`engine/scenes/
 * title.ts`) list, cursor and Credits scroll are likewise untouched — only
 * the action/tap/toggle debounce that gates its taps (`engine/input.ts`) is
 * scaled, the same as everywhere else.
 */
let scale = 1;

export function timeScale(): number {
  return scale;
}

/** Ignores anything that isn't a positive, finite number — a stray or malformed `?timescale=` leaves normal-speed play alone. Dev-only, like the rest of this module's write side (see the module comment). */
export function setTimeScale(next: number): void {
  if (!import.meta.env.DEV) return;
  if (Number.isFinite(next) && next > 0) scale = next;
}

/** A literal millisecond duration, divided by the current time scale — for anything handed straight to a real timer or tween rather than accumulated frame by frame. */
export function scaled(ms: number): number {
  return ms / scale;
}
