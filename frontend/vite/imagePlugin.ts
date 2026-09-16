import path from 'node:path';
import type { Plugin } from 'vite';
import { imagetools } from 'vite-imagetools';
import { ladders } from '../src/images/ladders.js';

const ASSET_DIR = /\/assets\/([^/]+)\//;

// Wraps imagetools() with this project's presets so a call site is just
// `import x from '../assets/leaders/brock.png?as=picture'` — the directory
// alone picks the widths/formats from ladders.ts.
export function imagePlugin(): Plugin {
  return imagetools({
    // Absolute because tooling runs both from `frontend/` and from the repo
    // root via `npm --prefix frontend`. `retention` stays unset: the
    // buildEnd prune only considers images from the current build, so a
    // retention would let a production build evict variants only dev or
    // vitest generated.
    cache: {
      dir: path.resolve(import.meta.dirname, '../node_modules/.cache/imagetools'),
    },
    defaultDirectives: (url) => {
      if (url.searchParams.get('as') !== 'picture') return new URLSearchParams();

      const dir = ASSET_DIR.exec(url.pathname)?.[1];
      const ladder = dir ? ladders[dir] : undefined;
      if (!ladder) {
        const known = Object.keys(ladders).join(', ');
        throw new Error(
          `imagePlugin: no preset for "${decodeURIComponent(url.pathname)}" — ` +
            `add one to ladders.ts for one of: ${known}`,
        );
      }

      // Emit w before format before quality: the cache key is
      // sha1(JSON.stringify(config) + srcHash) and config key order follows
      // URLSearchParams order, so reordering silently forks the cache and
      // doubles emitted files.
      const directives = new URLSearchParams();
      directives.set('w', ladder.widths.join(';'));
      directives.set('format', ladder.formats.join(';'));
      if (ladder.quality !== undefined) directives.set('quality', String(ladder.quality));
      return directives;
    },
  });
}
