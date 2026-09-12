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
 * on the URL, read once at boot (`engine/main.ts`) behind the same
 * `import.meta.env.DEV` guard as the rest of the debug surface
 * (`engine/debug.ts`), so no build a player runs can ever see anything else
 * (DESIGN.md §2).
 */
let scale = 1;

export function timeScale(): number {
  return scale;
}

/** Ignores anything that isn't a positive, finite number — a stray or malformed `?timescale=` leaves normal-speed play alone. */
export function setTimeScale(next: number): void {
  if (Number.isFinite(next) && next > 0) scale = next;
}

/** A literal millisecond duration, divided by the current time scale — for anything handed straight to a real timer or tween rather than accumulated frame by frame. */
export function scaled(ms: number): number {
  return ms / scale;
}
