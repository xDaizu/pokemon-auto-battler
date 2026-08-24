import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { BattleTurnLog } from '../api/types';
import { buildRawLog, buildReplaySrcdoc, DEFAULT_SPEED, STAGE_HEIGHT, STAGE_WIDTH } from '../battle/replayLog';
import '../styles/replayEmbed.css';

/** States `battle.subscribe`'s listener can be called with (verified against
 * play.pokemonshowdown.com/js/battle.js - it's an untyped string, not an enum
 * exported anywhere). Only 'turn' and 'ended' are acted on below; the others
 * exist so a corresponding case can be added later without re-deriving them. */
type ShowdownBattleState = 'turn' | 'playing' | 'paused' | 'ended' | 'callback' | 'error';

/** The subset of `Replays.battle`'s API (see play.pokemonshowdown.com/js/battle.js)
 * this app drives from the parent page. Typed locally rather than via a
 * `declare global` on `Window` - this shape only ever exists inside the
 * sandboxed iframe's own contentWindow, never the app's own `window`. */
interface ShowdownBattle {
  play(): void;
  pause(): void;
  seekBy(turns: number): void;
  seekTurn(turn: number): void;
  reset(): void;
  /** Single-listener, not a list - `subscribe` overwrites whatever was there
   * before, which here is `Replays.init()`'s own subscription driving the
   * native controls this app hides. Deliberate, not a bug: see the sandbox
   * note above for the same "we're taking over, not cooperating" trade-off. */
  subscribe(listener: (state: ShowdownBattleState) => void): void;
  readonly turn: number;
}

interface ReplaysWindow extends Window {
  Replays?: {
    battle?: ShowdownBattle;
    changeSetting(type: string, value: string): void;
  };
}

function getBattle(iframe: HTMLIFrameElement | null): ShowdownBattle | undefined {
  return (iframe?.contentWindow as ReplaysWindow | null)?.Replays?.battle;
}

/** Imperative controls the parent (BattleScreen) can issue against the
 * embedded scene. Every method is a safe no-op until the CDN script has
 * finished loading inside the frame. */
export interface ReplayHandle {
  play: () => void;
  pause: () => void;
  seekBy: (turns: number) => void;
  seekTurn: (turn: number) => void;
  reset: () => void;
}

interface ShowdownReplayEmbedProps {
  turns: BattleTurnLog[];
  /** Fires once the CDN scripts have loaded and playback control is actually
   * possible. Lets the parent retire its own turn-reveal timer in favor of
   * `onTurnChange` - and, just as importantly, tells it *not* to, if this
   * never fires because the CDN is unreachable (see ARCHITECTURE.md §7). */
  onReady?: () => void;
  /** Mirrors `battle.turn` every time the widget's own playback reaches a new
   * turn, whether that's from `.play()` running through it, or `seekBy`/
   * `seekTurn` jumping. This is what makes the scene the playback clock. */
  onTurnChange?: (turn: number) => void;
  onEnded?: () => void;
}

/**
 * Renders Pokemon Showdown's own replay widget inside an iframe, fed the
 * battle's raw protocol log. See docs/ARCHITECTURE.md §7 for why this
 * external dependency exists and frontend/src/battle/replayLog.ts for the
 * log-reconstruction details.
 *
 * The iframe is what keeps Showdown's unscoped stylesheets (it styles
 * `body.dark` and a global `@font-face`, among others) off the surrounding
 * app - a separate document has its own CSSOM, enforced by the browser.
 *
 * `sandbox` carries both `allow-scripts` and `allow-same-origin`. The parent
 * needs to read/call `contentWindow.Replays` to drive playback (below) and
 * to apply dark mode - with `allow-scripts` alone a `srcdoc` frame gets an
 * opaque, cross-origin `contentWindow`, and the browser throws a
 * `SecurityError` on every property read from it (verified: this broke
 * `changeSetting` outright). `allow-same-origin` makes a `srcdoc` frame
 * inherit the parent's origin instead, which is what removes that error -
 * but it's a real trust extension, not a free lunch: Showdown's own
 * remotely-loaded code (which this app doesn't control and which can change
 * without notice) gains the ability to read this app's own
 * document/localStorage/non-httpOnly cookies and reach `window.parent`, not
 * just render inside its box. Accepted deliberately for this app - the
 * session cookie is httpOnly regardless (see ARCHITECTURE.md), and
 * `allow-scripts` alone already permits outbound network requests, so the
 * incremental exposure is specifically read access to this app's own
 * page/storage, not a new exfiltration channel.
 */
export const ShowdownReplayEmbed = forwardRef<ReplayHandle, ShowdownReplayEmbedProps>(
  function ShowdownReplayEmbed({ turns, onReady, onTurnChange, onEnded }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    // Built once per battle result and never rebuilt - `turns` is static
    // after the initial fetch (one battle per team), and re-assigning
    // `srcDoc` would restart the widget from scratch mid-viewing.
    const srcdocRef = useRef<string | null>(null);
    if (srcdocRef.current === null) {
      srcdocRef.current = buildReplaySrcdoc(buildRawLog(turns));
    }

    // The ready-poll effect below only runs once (it tears down its own
    // interval as soon as it fires) but needs to call whatever `onReady`/
    // `onTurnChange`/`onEnded` the parent has *currently* passed, not
    // whichever were in scope back when the poll started - a plain ref kept
    // fresh after every render is the standard way to do that without
    // re-running (and re-subscribing) the effect itself on every prop change.
    const callbacksRef = useRef({ onReady, onTurnChange, onEnded });
    useEffect(() => {
      callbacksRef.current = { onReady, onTurnChange, onEnded };
    });

    // The CDN scripts referenced by the srcdoc load asynchronously after the
    // iframe's own initial parse, so `Replays.battle` isn't available the
    // instant the iframe mounts - poll briefly until it appears.
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const poll = window.setInterval(() => {
        const win = iframe.contentWindow as ReplaysWindow | null;
        const battle = win?.Replays?.battle;
        if (!win?.Replays || !battle) return;
        window.clearInterval(poll);
        // This app is dark-theme only; the widget defaults to light.
        win.Replays.changeSetting('color', 'dark');
        // The widget defaults to 'normal'; DEFAULT_SPEED overrides it.
        win.Replays.changeSetting('speed', DEFAULT_SPEED);
        // Makes the scene the playback clock: the parent stops running its
        // own turn-reveal timer once `onReady` fires, and instead follows
        // whatever turn the widget's own playback (play/pause/seekBy/
        // seekTurn, all driven by the parent too) reaches.
        battle.subscribe((state) => {
          if (state === 'turn') callbacksRef.current.onTurnChange?.(battle.turn);
          else if (state === 'ended') callbacksRef.current.onEnded?.();
        });
        callbacksRef.current.onReady?.();
        // The widget starts paused behind its own "Play" prompt - start it
        // once it's ready to, rather than leaving an animated scene sitting
        // inert until a click that duplicates the app's own Play button.
        battle.play();
      }, 150);
      return () => window.clearInterval(poll);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        play: () => getBattle(iframeRef.current)?.play(),
        pause: () => getBattle(iframeRef.current)?.pause(),
        seekBy: (n) => getBattle(iframeRef.current)?.seekBy(n),
        seekTurn: (n) => getBattle(iframeRef.current)?.seekTurn(n),
        reset: () => getBattle(iframeRef.current)?.reset(),
      }),
      [],
    );

    // The battle stage renders at a fixed intrinsic size and isn't
    // responsive; scale it down to fit narrower viewports (this app is
    // mobile-first) rather than letting it overflow or reflow.
    useLayoutEffect(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const observer = new ResizeObserver((entries) => {
        const available = entries[0]?.contentRect.width ?? STAGE_WIDTH;
        setScale(Math.min(1, available > 0 ? available / STAGE_WIDTH : 1));
      });
      observer.observe(wrap);
      return () => observer.disconnect();
    }, []);

    return (
      <div className="replay-embed" ref={wrapRef}>
        <div
          className="replay-embed-frame-wrap"
          style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}
        >
          <iframe
            ref={iframeRef}
            className="replay-embed-frame"
            title="Battle replay"
            srcDoc={srcdocRef.current}
            sandbox="allow-scripts allow-same-origin"
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    );
  },
);
