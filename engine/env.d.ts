/// <reference types="vite/client" />

/**
 * `VITE_REPOSITORY` is not read from a `.env` file the way an ordinary
 * `VITE_`-prefixed variable would be — it is `define`d in `vite.config.ts`
 * from `package.json`'s own `repository.url` at build time, so that the
 * project's repo URL reaches the engine (Credits screen, issue #65) without
 * ever being typed into engine source (CLAUDE.md hard rule 1). Declared here
 * so it type-checks like any other `import.meta.env` field.
 */
interface ImportMetaEnv {
  readonly VITE_REPOSITORY: string;
  /**
   * The save channel of a build that is not the release (`dev`, `pr-108`),
   * so its localStorage save stays apart from the released game's. Set by
   * `scripts/build-site.mjs` from `SITE_CHANNEL`; absent in the release, in
   * `npm run dev`, and in tests. See engine/save.ts.
   */
  readonly VITE_SAVE_CHANNEL?: string;
}
