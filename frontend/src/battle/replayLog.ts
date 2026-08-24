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
 * overflow the stage's nominal width. This never reaches the host page - see
 * the CSS-containment note on `buildReplaySrcdoc`. */
const FRAME_STYLE = `
  .battle-log, .replay-controls, .replay-controls-2, .trainer { display: none !important; }
  .wrapper { max-width: ${STAGE_WIDTH}px !important; margin: 0 !important; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
`;

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
 */
export function buildReplaySrcdoc(rawLog: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<script>window.Config = { whitelist: [] };</script>
<style>${FRAME_STYLE}</style>
</head><body>
<div class="wrapper replay-wrapper">
<input type="hidden" name="replayid" value="pab-local" />
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
