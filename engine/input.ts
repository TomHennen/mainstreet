import type { Facing } from './schema';

/**
 * One input path only (CLAUDE.md hard rule 4): pointer events for touch and
 * mouse, keyboard separately, and never two handlers on the same control. The
 * action button is debounced and key repeat is ignored — the same is true of
 * the "with you" panel's own toggle (`onToggle`, below).
 *
 * Three ways in, all of them pointer or key: tapping the world (the primary
 * one — the scene walks there), the d-pad and A button beside it, and the
 * keyboard behind both.
 */
const ACTION_DEBOUNCE_MS = 220;
/** Past this much travel between press and release it was a drag, not a tap. */
const TAP_SLOP_PX = 12;

const held: Record<Facing, boolean> = { up: false, down: false, left: false, right: false };
const listeners = new Set<() => void>();
const toggleListeners = new Set<() => void>();
const tapListeners = new Set<(x: number, y: number) => void>();
const dirListeners = new Set<(dir: Facing) => void>();
const dragListeners = new Set<(dy: number) => void>();
let lastAction = 0;
let lastToggle = 0;
let lastTap = 0;
/**
 * `x0`/`y0` are where the press started, kept still for the tap/drag
 * distinction on release; `x`/`y` are the last point seen, moved forward on
 * every `pointermove` so a drag reports one small step at a time rather than
 * the whole gesture at once.
 */
let pressed: { id: number; x0: number; y0: number; x: number; y: number } | null = null;

const KEY_DIRS: Record<string, Facing> = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right'
};

const ACTION_KEYS = new Set([' ', 'enter']);
/**
 * Toggles the "with you" panel (DESIGN.md §2, `engine/inventory.ts`) — "i",
 * free everywhere else in `KEY_DIRS`/`ACTION_KEYS` above. Debounced and
 * repeat-ignored exactly like the action key, on its own counter so opening
 * the panel never eats into the action button's own debounce window.
 */
const TOGGLE_KEYS = new Set(['i']);

/**
 * DOM controls the engine draws over the canvas (marked `data-overlay`) are
 * real links and buttons: the browser handles their taps and their Enter, and
 * the game must not swallow either. Still one input path per control — these
 * simply are not the game's controls.
 */
const isOverlay = (node: EventTarget | null): boolean =>
  node instanceof Element && Boolean(node.closest('[data-overlay]'));

export function isHeld(dir: Facing): boolean {
  return held[dir];
}

/** Returns an unsubscribe function. */
export function onAction(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The "with you" panel's own toggle (DESIGN.md §2) — the "i" key, debounced
 * like the action button but on its own clock (see `TOGGLE_KEYS` above).
 * Returns an unsubscribe function.
 */
export function onToggle(fn: () => void): () => void {
  toggleListeners.add(fn);
  return () => toggleListeners.delete(fn);
}

/**
 * A direction *pressed*, rather than held: the frame a d-pad button goes down
 * or an arrow key is first struck, key repeat ignored like the action key.
 * The map scene wants `isHeld` (walking is a hold); a list wants this, because
 * a quick press can begin and end inside one frame and a poll would miss it.
 * Returns an unsubscribe function.
 */
export function onDirection(fn: (dir: Facing) => void): () => void {
  dirListeners.add(fn);
  return () => dirListeners.delete(fn);
}

/**
 * A tap or click on the game surface, in client (CSS pixel) coordinates —
 * whoever is drawing knows how to turn those into a place in the world.
 * Returns an unsubscribe function.
 */
export function onTap(fn: (x: number, y: number) => void): () => void {
  tapListeners.add(fn);
  return () => tapListeners.delete(fn);
}

/**
 * A drag across the game surface — the vertical movement, in client (CSS)
 * pixels, since the last event, positive downward — for a scrollable list
 * (the title screen's Credits, DESIGN.md §2). It rides the same press as
 * `onTap`: a gesture short enough to stay inside the tap slop still fires
 * `onTap` on release, so a list that scrolls a few stray pixels can still be
 * dismissed with a tap. Returns an unsubscribe function.
 */
export function onDrag(fn: (dy: number) => void): () => void {
  dragListeners.add(fn);
  return () => dragListeners.delete(fn);
}

export function releaseAll(): void {
  pressed = null;
  for (const dir of Object.keys(held) as Facing[]) held[dir] = false;
  for (const el of document.querySelectorAll('.held')) el.classList.remove('held');
}

function fireDirection(dir: Facing): void {
  for (const fn of [...dirListeners]) fn(dir);
}

function fireAction(): void {
  const now = performance.now();
  if (now - lastAction < ACTION_DEBOUNCE_MS) return;
  lastAction = now;
  for (const fn of [...listeners]) fn();
}

function fireToggle(): void {
  const now = performance.now();
  if (now - lastToggle < ACTION_DEBOUNCE_MS) return;
  lastToggle = now;
  for (const fn of [...toggleListeners]) fn();
}

export function bindControls(root: Document = document): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (isOverlay(document.activeElement)) return;
      const key = event.key.toLowerCase();
      const dir = KEY_DIRS[key];
      if (dir || ACTION_KEYS.has(key) || TOGGLE_KEYS.has(key)) event.preventDefault();
      if (event.repeat) return;
      if (dir) {
        held[dir] = true;
        fireDirection(dir);
      }
      if (ACTION_KEYS.has(key)) fireAction();
      if (TOGGLE_KEYS.has(key)) fireToggle();
    },
    { capture: true }
  );

  window.addEventListener(
    'keyup',
    (event) => {
      const dir = KEY_DIRS[event.key.toLowerCase()];
      if (dir) held[dir] = false;
    },
    { capture: true }
  );

  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  for (const button of root.querySelectorAll<HTMLElement>('[data-dpad]')) {
    const dir = button.dataset.dpad as Facing;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      held[dir] = true;
      button.classList.add('held');
      fireDirection(dir);
    });
    const release = () => {
      held[dir] = false;
      button.classList.remove('held');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  for (const button of root.querySelectorAll<HTMLElement>('[data-action]')) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // Captured like the d-pad, so sliding a thumb off never leaves it lit.
      button.setPointerCapture(event.pointerId);
      button.classList.add('held');
      fireAction();
    });
    const release = () => button.classList.remove('held');
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  // The game surface, on one pointer path like every other control: the press
  // is remembered and the release decides what it was. With a box open the
  // press advances it and the release does nothing — so the tap that reads the
  // last line can never also walk the player to wherever that line was. With
  // no box open, a release close to its press is a tap on the world, and one
  // that travelled was a drag and is dropped.
  const stage = root.getElementById('stage');
  const forget = () => {
    pressed = null;
  };

  stage?.addEventListener('pointerdown', (event) => {
    forget();
    if (isOverlay(event.target)) return;
    event.preventDefault();
    if (document.body.dataset.dialogue === 'open') {
      fireAction();
      return;
    }
    pressed = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY };
  });

  stage?.addEventListener('pointermove', (event) => {
    if (!pressed || pressed.id !== event.pointerId) return;
    if (isOverlay(event.target)) return;
    if (document.body.dataset.dialogue === 'open') return;
    const dy = event.clientY - pressed.y;
    pressed.x = event.clientX;
    pressed.y = event.clientY;
    if (dy) for (const fn of [...dragListeners]) fn(dy);
  });

  stage?.addEventListener('pointerup', (event) => {
    const start = pressed;
    forget();
    if (!start || start.id !== event.pointerId) return;
    if (isOverlay(event.target)) return;
    if (document.body.dataset.dialogue === 'open') return;
    if (Math.hypot(event.clientX - start.x0, event.clientY - start.y0) > TAP_SLOP_PX) return;
    // Debounced like the action button, and for the same reason (hard rule 4).
    const now = performance.now();
    if (now - lastTap < ACTION_DEBOUNCE_MS) return;
    lastTap = now;
    for (const fn of [...tapListeners]) fn(event.clientX, event.clientY);
  });

  stage?.addEventListener('pointercancel', forget);
  stage?.addEventListener('pointerleave', forget);
}
