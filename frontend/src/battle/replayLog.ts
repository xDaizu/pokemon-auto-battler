import type { BattleTurnLog } from '../api/types';

/** Speed presets accepted by the embedded widget's `changeSetting('speed', …)`.
 * These are the widget's own vocabulary, not ours - don't rename them. */
export type ReplaySpeed = 'hyperfast' | 'fast' | 'normal' | 'slow' | 'reallyslow';

/** Fallback turn intervals (ms) used when the widget never loads and the text
 * log has to pace itself. Roughly matched to how the widget feels at each
 * preset; 'normal' preserves the historical 900ms reveal cadence. */
export const FALLBACK_TURN_MS: Record<ReplaySpeed, number> = {
  hyperfast: 200,
  fast: 450,
  normal: 900,
  slow: 1600,
  reallyslow: 3000,
};

/** Playback speed the app opens every battle at - applied to the CDN widget
 * via `changeSetting('speed', …)` (see ShowdownReplayEmbed) and, so the two
 * never drift apart, also indexes `FALLBACK_TURN_MS` for the text-only pacing
 * used when that widget never loads. The widget's own default is 'normal';
 * this overrides it. */
export const DEFAULT_SPEED: ReplaySpeed = 'fast';

/** Speed the "fast forward" control switches playback to - the fastest of
 * the widget's own presets. Applied the same way DEFAULT_SPEED is (via
 * `changeSetting('speed', …)` for the widget, and as the `FALLBACK_TURN_MS`
 * index for the text-only pacing), just swapped in and back out as that
 * control is toggled on and off rather than fixed for the whole battle. */
export const FAST_FORWARD_SPEED: ReplaySpeed = 'hyperfast';

/**
 * Rebuilds the raw Pokemon Showdown protocol log the replay widget expects
 * from our turn-bucketed form.
 *
 * Two things make this less trivial than a flatMap:
 *  - `collectOmniscientLog` (src/battle/log.ts) strips exactly one leading '|'
 *    from every line it stores, so each one has to be put back.
 *  - It also *consumes* `|turn|N` lines as bucket delimiters and never stores
 *    them. Without re-emitting them the widget has no turn markers at all,
 *    which silently breaks its turn counter, seekBy/seekTurn, and the
 *    scene-drives-log sync in BattleScreen. Hence the explicit re-synthesis.
 */
export function buildRawLog(turns: BattleTurnLog[]): string {
  const out: string[] = [];
  for (const turn of turns) {
    if (turn.turn > 0) out.push(`|turn|${turn.turn}`);
    for (const line of turn.lines) out.push(`|${line}`);
  }
  return out.join('\n');
}

/** Serializes the log for embedding in a <script> tag. `JSON.stringify` covers
 * quoting/newlines; escaping '</script' covers the one sequence that would
 * otherwise close the tag early. The dex vocabulary this app can produce can't
 * currently contain it, but the guard costs nothing and removes the bug class. */
function toScriptSafeJson(value: string): string {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

/** The battle stage renders at a fixed intrinsic size - it is not responsive,
 * so the parent scales it to fit rather than reflowing it. */
export const STAGE_WIDTH = 642;
export const STAGE_HEIGHT = 362;

/** Styling injected *into the frame*. Hides the widget's own text log and
 * controls (the app renders its own, translated, in its own design language)
 * plus the decorative trainer avatars, which duplicate the TeamRow header and
 * overflow the stage's nominal width. Also saturates the battle sprites -
 * targeted by their `/sprites/` CDN path rather than a class, since the
 * scene builds them as bare `<img>` tags with only an inline `style` - which
 * otherwise read as washed-out. This never reaches the host page - see
 * the CSS-containment note on `buildReplaySrcdoc`. */
const FRAME_STYLE = `
  .battle-log, .replay-controls, .replay-controls-2, .trainer { display: none !important; }
  .wrapper { max-width: ${STAGE_WIDTH}px !important; margin: 0 !important; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  img[src*="/sprites/"] { filter: saturate(1.2); }
`;

/**
 * Forces the widget's background art and battle music instead of leaving
 * them to its own randomizer.
 *
 * `BattleScene`'s constructor (graphics.js on the CDN) derives a `numericId`
 * from the trailing digits of the `replayid` field below - `parseInt(id.slice(
 * id.lastIndexOf('-') + 1))` - and falls back to `Math.random()` only when
 * that parse fails. Both the backdrop (`BattleBackdrops[numericId % 19]`,
 * gen6+) and the BGM (`1 + numericId % 15`, dispatched by `setBgm`) key off
 * that same number, which is why a non-numeric id like the old `'pab-local'`
 * made every reload reroll both independently.
 *
 * 142 was picked by working backwards from that same source: `142 % 19 === 9`
 * lands on `bg-earthycave.jpg`, and `142 % 15 === 7` (`bgmNum` 8) plays
 * `audio/bw2-kanto-gym-leader.mp3` - literally titled the Kanto gym leader
 * theme. Together they read as "Pewter Gym", which is the only opponent this
 * app has (`leaderId="brock"` in ThemeScope, `leaderThemes.ts`) - this'll need
 * to become a per-leader lookup once a second one exists, rather than one
 * constant for every battle.
 */
const SCENE_NUMERIC_ID = 142;

/**
 * Builds the complete HTML document for the replay iframe.
 *
 * The iframe is load-bearing, not a convenience: Showdown's stylesheets are
 * *not* scoped (replay.css styles `body.dark`, font-awesome registers a global
 * @font-face, battle.css claims generic names like `.inner`). Rendering this
 * in a separate document is what keeps all of it off the surrounding app, and
 * the browser enforces that rather than us relying on selector discipline.
 * It is also required for correctness: replay-embed.js bootstraps itself with
 * `document.write`, which only works during a document's initial parse.
 *
 * Note it deliberately does *not* load jQuery - replay-embed.js pulls in its
 * own bundled copy along with every stylesheet and data file it needs. The
 * jQuery/jQuery-UI tags found in third-party copies of this template are
 * redundant (verified working without them).
 *
 * Two of the head elements below patch around a real bug in replay-embed.js:
 * it loads its own dependency scripts (config.js, battledata.js, graphics.js,
 * ...) via plain `document.createElement('script')` + `.src` + `appendChild`,
 * never setting `.async = false` - so per spec they default to `async` and
 * the browser is free to *execute* them in whatever order they finish
 * downloading, not the order `requireScript()` was called in. graphics.js's
 * top-level code depends on that order: it prefixes every move-animation
 * sprite (`rock1.png`, `mudwisp.png`, ...) with `Dex.fxPrefix`, but only if
 * `window.Dex` (defined by battledata.js) already exists. Lose the race and
 * that prefixing silently no-ops, leaving the sprite as a bare relative
 * filename - invisible on the real play.pokemonshowdown.com, where the page's
 * own origin already *is* the CDN so the bare path resolves there by
 * accident anyway, but broken here since a `srcdoc` iframe's default base URL
 * is this app's own origin instead (surfaced as 404s against *this app*,
 * shown as broken move-animation images).
 *
 * `RACE_FIX_SCRIPT` is the actual fix: it wraps `document.createElement` for
 * the lifetime of this document so every dynamically-created `<script>` gets
 * `async = false` before insertion, which per spec restores in-order
 * execution (fetches still happen in parallel; running just waits for
 * insertion order) - the standard trick for taming exactly this kind of
 * loader. It has to run before replay-embed.js's own `requireScript` calls,
 * so it's inlined at the very top of `<head>`, ahead of everything else.
 * `<base>` is a second, independent layer: even with ordering fixed, it
 * makes any other bare-relative-URL reference in the CDN's code resolve
 * against the CDN instead of this app by default. */
const CDN_ORIGIN = 'https://play.pokemonshowdown.com/';

const RACE_FIX_SCRIPT = `
  var nativeCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName) {
    var el = nativeCreateElement(tagName);
    if (String(tagName).toLowerCase() === 'script') el.async = false;
    return el;
  };
`;

export function buildReplaySrcdoc(rawLog: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<base href="${CDN_ORIGIN}">
<script>${RACE_FIX_SCRIPT}</script>
<script>window.Config = { whitelist: [] };</script>
<style>${FRAME_STYLE}</style>
</head><body>
<div class="wrapper replay-wrapper">
<input type="hidden" name="replayid" value="pab-${SCENE_NUMERIC_ID}" />
<div class="battle"></div><div class="battle-log"></div>
<div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data"></script>
</div>
<script>document.querySelector('.battle-log-data').textContent = ${toScriptSafeJson(rawLog)};</script>
<script>
var daily = Math.floor(Date.now()/1000/60/60/24);
document.write('<scr'+'ipt src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"></scr'+'ipt>');
</script>
</body></html>`;
}
