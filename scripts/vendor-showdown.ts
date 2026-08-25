/**
 * Independent script (not wired into the runtime) that fetches a pinned
 * snapshot of the subset of Pokemon Showdown's client code the embedded
 * replay widget (`ShowdownReplayEmbed.tsx` / `battle/replayLog.ts`) needs,
 * and writes it under frontend/public/vendor/showdown/ so Vite ships it as
 * a plain static asset (frontend/public/ is copied verbatim to outDir - see
 * frontend/vite.config.ts). Binary sprite/fx/audio assets are deliberately
 * NOT vendored - they're still hotlinked live via Config.routes.client, set
 * inline by replayLog.ts. See docs/ARCHITECTURE.md §7/§8.
 *
 * Run with: npx tsx scripts/vendor-showdown.ts
 *
 * Safe to re-run: every file is re-fetched fresh from
 * play.pokemonshowdown.com and the same rewrites re-applied, rather than
 * editing this script's own previous output - so re-running is how you
 * bump the pinned snapshot. There is no tagged upstream release to pin
 * against, only "whatever was live on the fetch date", recorded in
 * scripts/output/vendor-showdown-manifest.json. After re-running, manually
 * re-verify per docs/ARCHITECTURE.md §7 (hover tooltips populate, no
 * console errors, Step control, dark mode/speed) before committing.
 *
 * Intentionally NOT vendored:
 *  - data/teambuilder-tables.js (15.8MB live) - grep-confirmed reachable
 *    only through ModdedDex.prototype.mod(), which this app's fixed
 *    gen9doublescustomgame format short-circuits before ever touching.
 *  - config/config.js - ~99% dead legacy boilerplate; its one load-bearing
 *    field (Config.routes) is hardcoded inline in replayLog.ts instead.
 *  - legacy font-awesome formats (eot/woff/ttf/svg) - modern-only stack,
 *    no documented legacy-browser requirement anywhere in this repo.
 *  - every sprite/fx/audio/cry file - stays hotlinked from
 *    play.pokemonshowdown.com via Config.routes.client.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDN_ORIGIN = 'https://play.pokemonshowdown.com/';
const VENDOR_DIR = fileURLToPath(new URL('../frontend/public/vendor/showdown/', import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL('output/vendor-showdown-manifest.json', import.meta.url));

interface VendorFile {
  /** Path (+ query string) on play.pokemonshowdown.com. */
  src: string;
  /** Path under frontend/public/vendor/showdown/. */
  dest: string;
  binary?: boolean;
  rewrite?: (text: string) => string;
}

/** Strips the CDN origin from every linkStyle('https://.../x')/
 * requireScript('https://.../x?q') call, dropping any query string, and
 * removes the two requires this app deliberately doesn't vendor. */
function rewriteReplayEmbed(text: string): string {
  let out = text;
  out = out.replace(
    /requireScript\('https:\/\/play\.pokemonshowdown\.com\/config\/config\.js\?a7'\);\n?/,
    "// config/config.js dropped - see docs/ARCHITECTURE.md §7. Its one\n" +
      '// load-bearing field (Config.routes) is hardcoded inline by\n' +
      '// replayLog.ts before this file loads.\n',
  );
  out = out.replace(
    /requireScript\('https:\/\/play\.pokemonshowdown\.com\/data\/teambuilder-tables\.js\?a7'\);\n?/,
    '// data/teambuilder-tables.js dropped - see docs/ARCHITECTURE.md §7.\n',
  );
  out = out.replace(
    /(linkStyle|requireScript)\('https:\/\/play\.pokemonshowdown\.com\/([^'?]+)(?:\?[^']*)?'\)/g,
    (_m, fn: string, path: string) => `${fn}('${path}')`,
  );
  return out;
}

/** battle.css's background/weather images stay hotlinked - rewrite the
 * relative url(../fx/...) references (relative to the CDN's style/
 * directory) to absolute CDN URLs so they still resolve once this
 * stylesheet is served from our own origin. Its `@import
 * url(./battle-log.css)` is left untouched - it resolves correctly as long
 * as battle-log.css stays a sibling file in the vendored tree. */
function rewriteBattleCss(text: string): string {
  return text.replace(/url\(\.\.\/fx\//g, `url(${CDN_ORIGIN}fx/`);
}

/** Trims the @font-face src list to the single vendored woff2 file,
 * dropping the eot/woff/ttf/svg legacy fallbacks. */
function rewriteFontAwesomeCss(text: string): string {
  return text.replace(
    /src: url\('fonts\/fontawesome-webfont\.eot\?v=4\.7\.0'\);\n\s*src: url\([^;]+;/,
    "src: url('fonts/fontawesome-webfont.woff2') format('woff2');",
  );
}

const FILES: VendorFile[] = [
  { src: 'js/lib/ps-polyfill.js', dest: 'js/lib/ps-polyfill.js' },
  { src: 'js/lib/jquery-1.11.0.min.js', dest: 'js/lib/jquery-1.11.0.min.js' },
  { src: 'js/lib/html-sanitizer-minified.js', dest: 'js/lib/html-sanitizer-minified.js' },
  { src: 'js/battle-sound.js', dest: 'js/battle-sound.js' },
  { src: 'js/battledata.js?a7', dest: 'js/battledata.js' },
  { src: 'data/pokedex-mini.js?a7', dest: 'data/pokedex-mini.js' },
  { src: 'data/pokedex-mini-bw.js?a7', dest: 'data/pokedex-mini-bw.js' },
  { src: 'data/graphics.js?a7', dest: 'data/graphics.js' },
  { src: 'data/pokedex.js?a7', dest: 'data/pokedex.js' },
  { src: 'data/moves.js?a7', dest: 'data/moves.js' },
  { src: 'data/abilities.js?a7', dest: 'data/abilities.js' },
  { src: 'data/items.js?a7', dest: 'data/items.js' },
  { src: 'js/battle-tooltips.js?a7', dest: 'js/battle-tooltips.js' },
  { src: 'js/battle.js?a7', dest: 'js/battle.js' },
  { src: 'style/replay.css?a7', dest: 'style/replay.css' },
  { src: 'style/utilichart.css?a7', dest: 'style/utilichart.css' },
  { src: 'style/battle-log.css?v15.1', dest: 'style/battle-log.css' },
  { src: 'style/battle.css?a7', dest: 'style/battle.css', rewrite: rewriteBattleCss },
  { src: 'style/font-awesome.css?', dest: 'style/font-awesome.css', rewrite: rewriteFontAwesomeCss },
  {
    src: 'style/fonts/fontawesome-webfont.woff2?v=4.7.0',
    dest: 'style/fonts/fontawesome-webfont.woff2',
    binary: true,
  },
  { src: 'js/replay-embed.js', dest: 'js/replay-embed.js', rewrite: rewriteReplayEmbed },
];

const INTENTIONALLY_DROPPED = [
  'data/teambuilder-tables.js (15.8MB, unreachable for this app’s fixed gen9doublescustomgame format)',
  'config/config.js (dead legacy boilerplate; Config.routes hardcoded inline in replayLog.ts instead)',
  'style/fonts/fontawesome-webfont.{eot,woff,ttf,svg} (legacy formats, modern-only stack)',
  'every sprite/fx/audio/cry file (stays hotlinked via Config.routes.client)',
];

async function fetchFile(src: string): Promise<ArrayBuffer> {
  const res = await fetch(`${CDN_ORIGIN}${src}`);
  if (!res.ok) throw new Error(`${src}: ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

async function main() {
  console.log(`Vendoring ${FILES.length} files from ${CDN_ORIGIN} into ${VENDOR_DIR} ...`);

  for (const file of FILES) {
    const buf = await fetchFile(file.src);
    const destPath = `${VENDOR_DIR}${file.dest}`;
    mkdirSync(dirname(destPath), { recursive: true });

    if (file.binary) {
      writeFileSync(destPath, Buffer.from(buf));
    } else {
      const text = Buffer.from(buf).toString('utf-8');
      writeFileSync(destPath, file.rewrite ? file.rewrite(text) : text);
    }
    console.log(`  ${file.src} -> ${file.dest} (${buf.byteLength} bytes)`);
  }

  const manifest = {
    fetchedAt: new Date().toISOString(),
    sourceOrigin: CDN_ORIGIN,
    files: FILES.map((f) => f.dest),
    intentionallyDropped: INTENTIONALLY_DROPPED,
  };
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${MANIFEST_PATH}`);
  console.log('Done. Manually re-verify per docs/ARCHITECTURE.md §7 before committing.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
