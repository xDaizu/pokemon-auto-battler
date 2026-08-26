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

/** Commands that are pure protocol setup/noise with nothing worth showing a
 * player - preamble (gen/tier/poke/...), timestamps, and upkeep markers. They
 * still occupy a step in the widget's own queue (it processes them like any
 * other line); they're just never rendered, and never a place to stop. */
export const SKIP_CMDS = new Set([
  't:',
  'gametype',
  'player',
  'gen',
  'tier',
  'clearpoke',
  'poke',
  'teampreview',
  'teamsize',
  'start',
  'rule',
  'upkeep',
]);

/** Commands that open a new block: a Pokémon being sent out, a Pokémon using a
 * move, or the battle ending. Everything else is a *consequence* of the most
 * recent one of these - the damage it dealt, the stat it dropped, the faint it
 * caused - which is what makes these the natural boundaries of a "move".
 *
 * Shared deliberately between the text log's indent/block split (BattleScreen's
 * `buildTurnLines`) and the step controls' move-boundary math below, so the
 * two can never independently disagree about where one move ends and the next
 * begins - a disagreement would show up as the log revealing more or less than
 * the animation just played. */
export const ROOT_CMDS = new Set(['switch', 'move', 'win', 'tie']);

export type LineRole = 'skip' | 'root' | 'consequence';

export function classifyLine(line: string): LineRole {
  const cmd = line.split('|')[0] ?? '';
  if (SKIP_CMDS.has(cmd)) return 'skip';
  if (ROOT_CMDS.has(cmd)) return 'root';
  return 'consequence';
}

/** Which lines of one turn bucket start a new block: any `ROOT_CMDS` line,
 * plus - matching the log's long-standing fallback - the first renderable line
 * of the turn even when it isn't one, so a turn that opens with a consequence
 * (weather ticking before either side has moved, say) still has something to
 * hang the rest off. `SKIP_CMDS` lines are never roots. */
export function rootLineIndices(lines: string[]): boolean[] {
  let sawRoot = false;
  return lines.map((line) => {
    const role = classifyLine(line);
    if (role === 'skip') return false;
    const isRoot = role === 'root' || !sawRoot;
    sawRoot = true;
    return isRoot;
  });
}

/**
 * Positions within the flat protocol-line sequence - the exact sequence
 * `buildRawLog` emits, synthesized `|turn|N` markers included.
 *
 * That alignment is the whole point: the widget stores what it's handed as
 * `stepQueue = log.split('\n')` with no further splitting or merging, so
 * `stepQueue[i]` *is* `buildRawLog`'s line `i`, and the widget's own
 * `battle.currentStep` (how many lines it has run) is directly comparable to
 * this app's own reveal cursor with no translation. `buildFlatMoveIndex`'s
 * test asserts `totalLines` against `buildRawLog` for exactly this reason - if
 * the two ever drift, every step control silently stops where the log doesn't.
 */
export interface FlatMoveIndex {
  /** Equal to `buildRawLog(turns).split('\n').length`. */
  totalLines: number;
  /** Ascending flat indices at which a move begins. A value `b` means
   * everything before `b` has resolved and that move is next to run. */
  moveBoundaries: number[];
  /** Flat index of each turn bucket's first *own* line - i.e. just past its
   * `|turn|N` marker where it has one. Parallel to `turns`. */
  turnLinesStart: number[];
}

export function buildFlatMoveIndex(turns: BattleTurnLog[]): FlatMoveIndex {
  const moveBoundaries: number[] = [];
  const turnLinesStart: number[] = [];
  let flat = 0;
  for (const turn of turns) {
    // Mirrors buildRawLog exactly - the marker is a queue entry of its own,
    // but it's structural, never a move in its own right.
    if (turn.turn > 0) flat++;
    turnLinesStart.push(flat);
    const roots = rootLineIndices(turn.lines);
    for (let i = 0; i < turn.lines.length; i++) {
      if (roots[i]) moveBoundaries.push(flat);
      flat++;
    }
  }
  return { totalLines: flat, moveBoundaries, turnLinesStart };
}

/**
 * Where to stop after resolving exactly one more move: the start of the move
 * *after* whichever one is pending at `revealedLine`, or the end of the battle
 * if that pending move is the last.
 *
 * Stopping at the next move's start - rather than at some count of lines - is
 * what makes one step mean one move *and its full resolution*: everything
 * between two roots (the crit, the damage, the status, the stat drop, the
 * faint) belongs to the earlier one and is swept in.
 */
export function nextMoveEndBoundary(index: FlatMoveIndex, revealedLine: number): number {
  const { moveBoundaries, totalLines } = index;
  // The move to finish is the last one that has *started* - not the next one
  // that hasn't. The cursor doesn't only ever sit on a boundary: continuous
  // playback stops it wherever the widget happened to be, which is routinely
  // part-way through a move's consequences. From there, one step means
  // "finish resolving this move", so the search has to look backwards from
  // the cursor rather than forwards from it.
  let pending = -1;
  for (let i = 0; i < moveBoundaries.length; i++) {
    if (moveBoundaries[i]! <= revealedLine) pending = i;
  }
  // Before the first move has begun, that first move is the one to resolve.
  if (pending < 0) pending = 0;
  return moveBoundaries[pending + 1] ?? totalLines;
}

/**
 * Inverse of the turn-bucket flattening: maps a flat reveal cursor back to
 * "these turns are fully revealed, and this many lines into the next one".
 * Needed because a move boundary lands wherever the battle put it, which is
 * usually mid-turn - so the log has to be able to render a partial turn
 * rather than only whole ones.
 */
export function turnProgressForFlatIndex(
  index: FlatMoveIndex,
  turns: BattleTurnLog[],
  revealedLine: number,
): { lastVisibleTurnIndex: number; visibleLinesInLastTurn: number } {
  let lastVisibleTurnIndex = -1;
  let visibleLinesInLastTurn = 0;
  for (let t = 0; t < turns.length; t++) {
    const start = index.turnLinesStart[t]!;
    if (revealedLine <= start) break;
    const visible = Math.min(turns[t]!.lines.length, revealedLine - start);
    lastVisibleTurnIndex = t;
    visibleLinesInLastTurn = visible;
  }
  return { lastVisibleTurnIndex, visibleLinesInLastTurn };
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
 * controls (the app renders its own, translated, in its own design language).
 * Also saturates the battle sprites - targeted by their `/sprites/` CDN path
 * rather than a class, since the scene builds them as bare `<img>` tags with
 * only an inline `style` - which otherwise read as washed-out. This never
 * reaches the host page - see the CSS-containment note on `buildReplaySrcdoc`.
 *
 * The widget's `.leftbar`/`.rightbar` sidebars are the scene's own per-trainer
 * team strips - `.leftbar` for the player ("near"), `.rightbar` for the rival
 * ("far"). BattleScreen has no header of its own at all any more (no
 * TeamRow, for either side), so both bars are left showing - this is the
 * only place either roster is displayed during a battle. Each side's
 * trainer name and avatar are hidden, though: the names are raw, untranslated
 * protocol labels ("Red"/"Brock", not this app's localized text), and the
 * avatars are generic placeholder sprites unrelated to this app's own art.
 * Only the team-icon strips are left up. */
const FRAME_STYLE = `
  .battle-log, .replay-controls, .replay-controls-2 { display: none !important; }
  .trainer strong, .trainersprite { display: none !important; }
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
 * Each leader picks their own id the same way this one was: working backwards
 * from those two formulas to land on a fitting backdrop/BGM pair - see
 * `LeaderTheme.sceneId` (leaderThemes.ts). `DEFAULT_SCENE_ID` below is only
 * the fallback for a leader with no theme entry yet; it's Brock's own value
 * (142: `142 % 19 === 9` lands on `bg-earthycave.jpg`, `142 % 15 === 7`
 * (`bgmNum` 8) plays `audio/bw2-kanto-gym-leader.mp3` - literally titled the
 * Kanto gym leader theme, together reading as "Pewter Gym").
 */
export const DEFAULT_SCENE_ID = 142;

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
 * The JS/CSS here is a **pinned local snapshot**, not a live CDN hotlink:
 * `scripts/vendor-showdown.ts` fetches the subset of Showdown's replay-widget
 * code this needs and writes it to `frontend/public/vendor/showdown/` (see
 * docs/ARCHITECTURE.md §7/§8) - `VENDOR_BASE` points at that local root.
 * Sprites/fx/audio/cries are deliberately *not* vendored (large, tied to
 * Showdown's own dex updates) and stay hotlinked live from
 * play.pokemonshowdown.com, via `Config.routes.client` below - `battledata.js`
 * and `battle-sound.js` build every sprite/fx/audio URL off that field,
 * independent of where the JS/CSS code itself was loaded from.
 *
 * Two of the head elements below patch around a real bug in replay-embed.js:
 * it loads its own dependency scripts (battledata.js, graphics.js, ...) via
 * plain `document.createElement('script')` + `.src` + `appendChild`, never
 * setting `.async = false` - so per spec they default to `async` and the
 * browser is free to *execute* them in whatever order they finish
 * downloading, not the order `requireScript()` was called in. graphics.js's
 * top-level code depends on that order: it prefixes every move-animation
 * sprite (`rock1.png`, `mudwisp.png`, ...) with `Dex.fxPrefix`, but only if
 * `window.Dex` (defined by battledata.js) already exists. Lose the race and
 * that prefixing silently no-ops, leaving the sprite as a bare relative
 * filename - invisible on the real play.pokemonshowdown.com, where the page's
 * own origin already *is* the CDN so the bare path resolves there by
 * accident anyway, but broken here since a `srcdoc` iframe's default base URL
 * is this app's own origin instead (surfaced as 404s against *this app*,
 * shown as broken move-animation images). Note `<base>` no longer doubles as
 * a safety net for this specific race the way it did when it pointed at the
 * CDN origin: it now points at the local vendor root, which has no sprite
 * files, so a lost race here would 404 rather than accidentally resolve.
 * `RACE_FIX_SCRIPT` (below) is what actually prevents the race, not `<base>`.
 *
 * `RACE_FIX_SCRIPT` is the actual fix: it wraps `document.createElement` for
 * the lifetime of this document so every dynamically-created `<script>` gets
 * `async = false` before insertion, which per spec restores in-order
 * execution (fetches still happen in parallel; running just waits for
 * insertion order) - the standard trick for taming exactly this kind of
 * loader. It has to run before replay-embed.js's own `requireScript` calls,
 * so it's inlined at the very top of `<head>`, ahead of everything else.
 * `<base>` is a second, independent layer: even with ordering fixed, it
 * makes any other bare-relative-URL reference in the vendored code (the
 * rewritten `requireScript`/`linkStyle` calls, plus e.g. font-awesome.css's
 * relative `url('fonts/...')`) resolve against the vendor root instead of
 * this app's own origin by default. */
const VENDOR_BASE = `${import.meta.env.BASE_URL}vendor/showdown/`;

const RACE_FIX_SCRIPT = `
  var nativeCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName) {
    var el = nativeCreateElement(tagName);
    if (String(tagName).toLowerCase() === 'script') el.async = false;
    return el;
  };
`;

export function buildReplaySrcdoc(rawLog: string, sceneId: number = DEFAULT_SCENE_ID): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<base href="${VENDOR_BASE}">
<script>${RACE_FIX_SCRIPT}</script>
<script>window.Config = {
  whitelist: [],
  // Verbatim from https://play.pokemonshowdown.com/config/config.js as of
  // 2026-08-25 - that file isn't vendored (see scripts/vendor-showdown.ts,
  // docs/ARCHITECTURE.md §7), so this is what keeps every sprite/fx/audio
  // request battledata.js/battle-sound.js build pointed at Showdown's live
  // CDN regardless of where this widget's own code is served from. These
  // routes essentially never change; re-check on every re-vendor.
  routes: {
    root: 'pokemonshowdown.com',
    client: 'play.pokemonshowdown.com',
    dex: 'dex.pokemonshowdown.com',
    replays: 'replay.pokemonshowdown.com',
    users: 'pokemonshowdown.com/users',
    teams: 'teams.pokemonshowdown.com',
  },
};</script>
<style>${FRAME_STYLE}</style>
</head><body>
<div class="wrapper replay-wrapper">
<input type="hidden" name="replayid" value="pab-${sceneId}" />
<div class="battle"></div><div class="battle-log"></div>
<div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data"></script>
</div>
<script>document.querySelector('.battle-log-data').textContent = ${toScriptSafeJson(rawLog)};</script>
<script>document.write('<scr'+'ipt src="js/replay-embed.js"></scr'+'ipt>');</script>
</body></html>`;
}
