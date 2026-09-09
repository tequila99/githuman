import { defineBoot } from '#q-app'
import { createPinia } from 'pinia'

// Installed manually instead of via Quasar's `sourceFiles.store` auto-wiring:
// that mechanism resolves the store path through two different, incompatible
// rules once `@` is remapped away from Quasar's default `src/` (see the
// `build.alias` comment in quasar.config.ts) — no single path value can
// satisfy both, and Quasar silently skips installing Pinia at all if it
// disagrees. Must run before any boot file that calls a Pinia store
// (see the `boot` order in quasar.config.ts).
export default defineBoot(({ app }) => {
  app.use(createPinia())
})
