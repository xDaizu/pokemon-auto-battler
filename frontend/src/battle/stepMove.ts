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
  /** Gate the internal `nextStep`'s own do-while batch loop checks before
   * consuming each queue line - see `stepOneMove` for why this has to be
   * shadowed too, not just `nextStep` itself. */
  shouldStep(): boolean;
  readonly currentStep: number;
  readonly atQueueEnd: boolean;
}

/**
 * Installs a permanent progress listener on the widget's `nextStep`, firing
 * `onStep(battle.currentStep)` after every batch of queue lines the ordinary
 * play loop consumes.
 *
 * This is the missing piece the module doc above complains about: "there is
 * no per-step subscription event ('turn' is per turn...)". `'turn'` only
 * fires once a whole turn's moves have all resolved, which is what made the
 * log jump forward in whole-turn chunks during ordinary `.play()` instead of
 * growing move by move alongside the animation. `nextStep` itself runs once
 * per animated batch - the same granularity `stepOneMove` below already
 * stops on - so wrapping it is the fix, using the exact same trick.
 *
 * Shares that function's own-property-over-the-prototype shadow, and for the
 * same reason: `nextStep`'s asynchronous continuation re-enters via
 * `this.nextStep()`, a dynamic lookup that only an own-property shadow (not
 * a captured reference) keeps catching on every later batch.
 *
 * `stepOneMove` temporarily replaces this instance property with its own
 * step-and-stop shadow while a step is in flight, then `delete`s it back to
 * nothing once the step lands - which would silently drop this tracking for
 * good after the first Step click. Call this again once a step lands (see
 * `ShowdownReplayEmbed`'s `stepMove` handle) to reinstall it.
 */
export function trackStepProgress(battle: SteppableBattle, onStep: (step: number) => void): void {
  const prototype = Object.getPrototypeOf(battle) as SteppableBattle;
  const original = prototype.nextStep;
  const instance = battle as Omit<SteppableBattle, 'nextStep'> & { nextStep?: unknown };
  instance.nextStep = function (this: SteppableBattle) {
    original.call(this);
    onStep(this.currentStep);
  };
}

/**
 * Plays forward - fully animated - until `battle.currentStep` reaches
 * `targetStep`, then pauses. `onLanded` fires once, immediately after the
 * real `pause()`, which also emits the widget's ordinary 'paused' event, so
 * the usual position-sync path needs no special case for stepping.
 *
 * Three details carry the whole thing:
 *
 *  - Both shadows are installed as **own properties** of the battle instance,
 *    and the originals are read off the prototype. `nextStep`'s asynchronous
 *    continuation (inside the `animations.done()` callback it attaches after
 *    each animated batch) re-enters via `this.nextStep()` - a dynamic property
 *    lookup, not a captured reference. An own-property shadow therefore
 *    catches every later batch of the same in-flight sequence, not just the
 *    first call. Patching the prototype would work too but would leak across
 *    every battle instance; capturing `battle.nextStep`/`shouldStep` as "the
 *    original" would risk a shadow wrapping a shadow.
 *  - `nextStep`'s own body is a synchronous `do...while` loop that keeps
 *    consuming queue lines - calling `this.shouldStep()` between each - until
 *    one of them actually queues an animation to wait on. A line with nothing
 *    to animate (a `|turn|N` marker, a silent status tick, ...) can't stop it,
 *    so left alone the loop runs *past* `targetStep` and into the next move's
 *    own opening line - the first one that does animate - before ever
 *    returning control here. By then that next move's animation has already
 *    started, and calling `pause()` on it doesn't leave it playing: `pause()`
 *    → `scene.pause()` → `stopAnimation()` → jQuery `.finish()`, which snaps
 *    it straight to its end state instead. The symptom is exactly "the first
 *    attack of a turn needs two clicks" - the click that was meant to land on
 *    the turn boundary silently swallows that attack's animation, and only
 *    its trailing consequence lines (processed as their own, unaffected,
 *    later batch) show up on the next click.
 *  - Shadowing `shouldStep` too closes that gap: since the do-while loop
 *    checks it before consuming each line, forcing it to report `false` once
 *    `currentStep` reaches `targetStep` stops the loop *before* it touches
 *    the next move's line at all. That's what keeps the eventual `pause()`
 *    landing in the gap between batches, where nothing is mid-flight and
 *    `.finish()` has nothing to truncate - the same invariant the single
 *    `nextStep` shadow relied on, just enforced one line earlier.
 */
export function stepOneMove(battle: SteppableBattle, targetStep: number, onLanded: () => void): void {
  if (battle.currentStep >= targetStep || battle.atQueueEnd) {
    battle.pause();
    onLanded();
    return;
  }

  const prototype = Object.getPrototypeOf(battle) as SteppableBattle;
  const originalNextStep = prototype.nextStep;
  const originalShouldStep = prototype.shouldStep;
  const instance = battle as Omit<SteppableBattle, 'nextStep' | 'shouldStep'> & {
    nextStep?: unknown;
    shouldStep?: unknown;
  };

  function shadowedShouldStep(this: SteppableBattle) {
    if (this.currentStep >= targetStep) return false;
    return originalShouldStep.call(this);
  }

  function shadowedNextStep(this: SteppableBattle) {
    originalNextStep.call(this);
    if (this.currentStep < targetStep && !this.atQueueEnd) return;
    delete instance.nextStep;
    delete instance.shouldStep;
    this.pause();
    onLanded();
  }

  instance.nextStep = shadowedNextStep;
  instance.shouldStep = shadowedShouldStep;
  battle.play();
}
