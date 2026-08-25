/**
 * Stepping the embedded Showdown replay forward by one move, with its
 * animation intact.
 *
 * The widget offers no API for this. Its two public ways of moving forward
 * are `play()` (continuous, animated) and `seekBy`/`seekTurn` (jump, and
 * explicitly *not* animated - both call `scene.animationOff()` on the way in).
 * Nothing stops after a fixed amount of animated playback, and the finest
 * granularity anything public offers is a whole turn.
 *
 * Nor can it be faked from outside by pausing on a timer: `battle.pause()`
 * calls `scene.pause()` → `stopAnimation()` → jQuery `.finish()`, which snaps
 * whatever is mid-flight straight to its end state. Pausing is only clean in
 * the gap *between* animation batches, which is not a moment the parent page
 * can observe - there is no per-step subscription event ('turn' is per turn,
 * and silent while seeking; 'callback' fires only on a literal `|callback|`
 * protocol line).
 *
 * So this drives the ordinary, animated play loop and teaches it to stop
 * itself, by shadowing the one method that loop runs through.
 *
 * **This is reverse-engineered from unversioned third-party source** (verified
 * against play.pokemonshowdown.com/js/battle.js and /data/graphics.js) and
 * Showdown can change it without notice. It is the same trade-off already
 * accepted for `RACE_FIX_SCRIPT` and the `allow-same-origin` sandbox note in
 * replayLog.ts / ShowdownReplayEmbed.tsx: a real dependency on internals, taken
 * deliberately, and degrading to "the step control misbehaves" rather than to a
 * broken app if it ever rots.
 */

/** The slice of the widget's `Battle` that stepping touches. Deliberately
 * structural rather than an import - this object only ever exists inside the
 * sandboxed iframe, and the fake in the tests satisfies the same shape. */
export interface SteppableBattle {
  play(): void;
  pause(): void;
  nextStep(): void;
  readonly currentStep: number;
  readonly atQueueEnd: boolean;
}

/**
 * Plays forward - fully animated - until `battle.currentStep` reaches
 * `targetStep`, then pauses. `onLanded` fires once, immediately after the
 * real `pause()`, which also emits the widget's ordinary 'paused' event, so
 * the usual position-sync path needs no special case for stepping.
 *
 * Two details carry the whole thing:
 *
 *  - The shadow is installed as an **own property** of the battle instance,
 *    and the original is read off the prototype. `nextStep`'s asynchronous
 *    continuation (inside the `animations.done()` callback it attaches after
 *    each animated batch) re-enters via `this.nextStep()` - a dynamic property
 *    lookup, not a captured reference. An own-property shadow therefore
 *    catches every later batch of the same in-flight sequence, not just the
 *    first call. Patching the prototype would work too but would leak across
 *    every battle instance; capturing `battle.nextStep` as "the original"
 *    would risk a shadow wrapping a shadow.
 *  - The check runs *after* delegating, so each batch plays out in full. The
 *    pause therefore always lands between batches, where nothing is animating
 *    and `.finish()` has nothing to truncate.
 */
export function stepOneMove(battle: SteppableBattle, targetStep: number, onLanded: () => void): void {
  if (battle.currentStep >= targetStep || battle.atQueueEnd) {
    battle.pause();
    onLanded();
    return;
  }

  const prototype = Object.getPrototypeOf(battle) as SteppableBattle;
  const original = prototype.nextStep;
  const instance = battle as Omit<SteppableBattle, 'nextStep'> & { nextStep?: unknown };

  function shadowed(this: SteppableBattle) {
    original.call(this);
    if (this.currentStep < targetStep && !this.atQueueEnd) return;
    delete instance.nextStep;
    this.pause();
    onLanded();
  }

  instance.nextStep = shadowed;
  battle.play();
}
