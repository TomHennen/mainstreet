import type { Facing } from './schema';

/**
 * One input path only (CLAUDE.md hard rule 4): pointer events for touch and
 * mouse, keyboard separately, and never two handlers on the same control. The
 * action button is debounced and key repeat is ignored.
 */
const ACTION_DEBOUNCE_MS = 220;

const held: Record<Facing, boolean> = { up: false, down: false, left: false, right: false };
const listeners = new Set<() => void>();
let lastAction = 0;

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

export function releaseAll(): void {
  for (const dir of Object.keys(held) as Facing[]) held[dir] = false;
  for (const el of document.querySelectorAll('.held')) el.classList.remove('held');
}

function fireAction(): void {
  const now = performance.now();
  if (now - lastAction < ACTION_DEBOUNCE_MS) return;
  lastAction = now;
  for (const fn of [...listeners]) fn();
}

export function bindControls(root: Document = document): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (isOverlay(document.activeElement)) return;
      const key = event.key.toLowerCase();
      const dir = KEY_DIRS[key];
      if (dir || ACTION_KEYS.has(key)) event.preventDefault();
      if (event.repeat) return;
      if (dir) held[dir] = true;
      if (ACTION_KEYS.has(key)) fireAction();
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

  // Tapping the game surface advances dialogue, and only that: the scene sets
  // this attribute while a box is open, so a tap can never also trigger a talk.
  const stage = root.getElementById('stage');
  stage?.addEventListener('pointerdown', (event) => {
    if (isOverlay(event.target)) return;
    if (document.body.dataset.dialogue !== 'open') return;
    event.preventDefault();
    fireAction();
  });
}
