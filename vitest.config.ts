import { defineConfig } from 'vitest/config';

/**
 * Engine logic only (CLAUDE.md: keep dependencies minimal — no jsdom or
 * happy-dom). Tests run under plain Node with no DOM: a module that needs a
 * browser to import cleanly doesn't belong under test here, it belongs in a
 * refactor (see engine/bus.ts, which dropped its Phaser import for exactly
 * this reason).
 */
export default defineConfig({
  test: {
    include: ['engine/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
