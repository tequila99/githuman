// Custom ESM resolve hook so `node --test` can load src/web/*.ts files
// directly: they use the `@/` alias (see quasar.config.ts build.alias),
// which only Vite/Quasar understands — plain Node has no idea `@/` means
// `src/web/`. This hook rewrites just that one prefix and defers
// everything else (including Node's own .ts type-stripping) to the
// default resolver, so it composes rather than replacing it.
const WEB_ROOT = new URL('../../src/web/', import.meta.url)

// Web imports omit extensions (Vite resolves them); plain Node doesn't,
// so retry with `.ts` appended when the bare specifier isn't found.
async function resolveWithTsFallback(url, context, nextResolve) {
  try {
    return await nextResolve(url, context)
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND' || url.endsWith('.ts')) throw err
    return nextResolve(`${url}.ts`, context)
  }
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const url = new URL(specifier.slice(2), WEB_ROOT).href
    return resolveWithTsFallback(url, context, nextResolve)
  }
  // Relative imports inside src/web/*.ts also omit extensions (Vite-style).
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveWithTsFallback(specifier, context, nextResolve)
  }
  return nextResolve(specifier, context)
}
