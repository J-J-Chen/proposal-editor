// Dev-only node resolve hook: map the "@/..." tsconfig alias to ./src/... and append a .ts/.tsx
// extension for extensionless relative imports, so offline scripts (seed generation, smoke tests)
// can run the app's TS modules under plain `node` (which handles mupdf's top-level await; tsx does
// not). Not used by the Next.js build — that has its own resolver.
import { pathToFileURL } from 'node:url';

const SRC = pathToFileURL(process.cwd()).href + '/src/';

export async function resolve(specifier, context, nextResolve) {
  const spec = specifier.startsWith('@/') ? SRC + specifier.slice(2) : specifier;
  try {
    return await nextResolve(spec, context);
  } catch (err) {
    // extensionless TS + directory-index resolution (bundler-style), which node ESM lacks.
    for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try {
        return await nextResolve(spec + suffix, context);
      } catch {
        /* try next candidate */
      }
    }
    throw err;
  }
}
