import { describe, test, expect, vi } from 'vitest';
import { stepOneMove, trackStepProgress, type SteppableBattle } from './stepMove';

/**
 * Stands in for the widget's own `Battle`, reproducing the behaviours
 * `stepOneMove` actually depends on (all verified against battle.js):
 *
 *  - `nextStep` and `shouldStep` live on the **prototype**, and `nextStep`'s
 *    continuation re-enters through `this.nextStep()` - a dynamic lookup,
 *    which is what lets an own-property shadow intercept later batches.
 *  - `nextStep`'s own body is a synchronous `do...while` that keeps consuming
 *    queue entries - checking `this.shouldStep()` between each - until one of
 *    them has something worth animating on. Modelled here as a `boolean[]`:
 *    `true` means that line queues an animation and ends the current batch;
 *    `false` means it's silent (a `|turn|N` marker, a no-op consequence line)
 *    and the loop keeps going without yielding.
 *  - once a batch does end on an animated line, the continuation is
 *    **asynchronous** - standing in for the real `animations.done()` callback
 *    that fires only once that animation finishes playing.
 */
class FakeBattle implements SteppableBattle {
  currentStep = 0;
  atQueueEnd = false;
  paused = true;
  pauseCalls = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  private readonly queue: boolean[];
  constructor(queue: boolean[]) {
    this.queue = queue;
  }

  play() {
    this.paused = false;
    this.nextStep();
  }

  pause() {
    this.paused = true;
    this.pauseCalls++;
    // Standing in for `scene.pause()`'s jQuery `.finish()`: whatever batch
    // was still in flight is cut short rather than left to complete.
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
  }

  shouldStep() {
    if (this.atQueueEnd) return false;
    return !this.paused;
  }

  nextStep() {
    if (!this.shouldStep()) return;
    let animated = false;
    do {
      if (this.currentStep >= this.queue.length) {
        this.atQueueEnd = true;
        return;
      }
      animated = this.queue[this.currentStep]!;
      this.currentStep++;
    } while (!animated && this.shouldStep());

    if (this.paused || !animated) return;
    this.pending = setTimeout(() => this.nextStep(), 1);
  }
}

/** A queue of `n` lines, every one of them animated - each line is its own
 * batch, which is the simple case the original test suite exercised before
 * `nextStep`'s do-while batching (and the bug it hides) was modelled. */
function allAnimated(n: number): boolean[] {
  return Array(n).fill(true) as boolean[];
}

/** Runs the fake's queued continuations to a standstill. */
async function settle() {
  await vi.advanceTimersByTimeAsync(50);
}

describe('stepOneMove', () => {
  test('stops exactly at the target step, not before or past it', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(20));
    const onLanded = vi.fn();

    stepOneMove(battle, 5, onLanded);
    await settle();

    expect(battle.currentStep).toBe(5);
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(battle.paused).toBe(true);
    vi.useRealTimers();
  });

  // The shadows are own properties over prototype methods; if left installed,
  // the next step would capture *them* as "the original" and wrap a wrapper -
  // each step compounding the last.
  test('restores the prototype methods once it lands', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(20));

    stepOneMove(battle, 3, () => {});
    await settle();

    expect(Object.prototype.hasOwnProperty.call(battle, 'nextStep')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(battle, 'shouldStep')).toBe(false);
    vi.useRealTimers();
  });

  test('steps repeatedly, each landing on its own target', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(20));

    for (const target of [4, 9, 11]) {
      stepOneMove(battle, target, () => {});
      await settle();
      expect(battle.currentStep).toBe(target);
    }
    vi.useRealTimers();
  });

  test('stops at the end of the queue rather than spinning past it', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(6));
    const onLanded = vi.fn();

    stepOneMove(battle, 999, onLanded);
    await settle();

    expect(battle.atQueueEnd).toBe(true);
    expect(battle.currentStep).toBe(6);
    expect(onLanded).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('lands immediately when the target has already been passed', () => {
    const battle = new FakeBattle(allAnimated(20));
    battle.currentStep = 8;
    const onLanded = vi.fn();

    stepOneMove(battle, 5, onLanded);

    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(battle.pauseCalls).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(battle, 'nextStep')).toBe(false);
  });

  test('pauses once per step, not once per animated batch', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(20));

    stepOneMove(battle, 7, () => {});
    await settle();

    expect(battle.pauseCalls).toBe(1);
    vi.useRealTimers();
  });

  // Regression test for the "first attack of a turn needs two clicks" bug:
  // a silent line sitting right at the target (the synthesized `|turn|N`
  // marker, in the real widget) has nothing to animate on, so the do-while
  // batch that reaches it can't stop there on its own - it only stops once it
  // reaches the *next* animated line, which belongs to the next move. Without
  // the `shouldStep` shadow, that overshoot line gets consumed - and its
  // animation cut short by `pause()` - a whole move before the app asked for
  // it.
  test('does not overshoot into the next move when the boundary line is silent', async () => {
    vi.useFakeTimers();
    // Lines 0-1 animated (the move being finished), line 2 silent (its turn
    // marker), line 3 animated (the *next* move's own opening line - must be
    // left untouched), line 4 animated (that next move's first consequence).
    const battle = new FakeBattle([true, true, false, true, true]);
    const onLanded = vi.fn();

    stepOneMove(battle, 3, onLanded);
    await settle();

    expect(battle.currentStep).toBe(3);
    expect(battle.paused).toBe(true);
    expect(onLanded).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // Same shape, but with several consecutive silent lines before the next
  // move's animated opener - the loop has further to run past the boundary
  // before it would naturally find something to stop on.
  test('does not overshoot across a run of several silent lines', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle([true, false, false, false, true, true]);
    const onLanded = vi.fn();

    stepOneMove(battle, 4, onLanded);
    await settle();

    expect(battle.currentStep).toBe(4);
    expect(battle.paused).toBe(true);
    expect(onLanded).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('trackStepProgress', () => {
  // The regression this guards: 'turn' (the only subscription event ordinary
  // playback fires) only lands once a whole turn has resolved, which left the
  // log jumping forward in whole-turn chunks. This is the fix - reporting
  // every batch `nextStep` consumes during a plain `.play()`, not just once
  // the turn ends. (The trailing repeat of the last value is `nextStep`'s own
  // harmless final no-op call once it notices the queue is exhausted - the
  // real widget does the same; a repeated value is a no-op for a reveal
  // cursor that only ever moves forward.)
  test('reports progress after every animated batch during ordinary play, not just at the end', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(5));
    const onStep = vi.fn();

    trackStepProgress(battle, onStep);
    battle.play();
    await settle();

    expect(onStep.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 5]);
    vi.useRealTimers();
  });

  // A batch can swallow several silent lines before landing on the one that
  // actually animates (see the overshoot tests above) - progress should still
  // be reported once per batch, at wherever that batch actually stopped.
  test('reports the batch boundary, not one call per queue line', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle([true, false, false, true, true]);
    const onStep = vi.fn();

    trackStepProgress(battle, onStep);
    battle.play();
    await settle();

    expect(onStep.mock.calls.map((c) => c[0])).toEqual([1, 4, 5, 5]);
    vi.useRealTimers();
  });

  // stepOneMove deletes its own shadow off `nextStep` once a step lands,
  // uncovering the bare prototype method underneath - which would silently
  // drop this tracking for good if it isn't reinstalled afterward (see
  // ShowdownReplayEmbed's `stepMove` handle, which does exactly that).
  test('survives being reinstalled after a step overwrote it', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(allAnimated(10));
    const onStep = vi.fn();

    trackStepProgress(battle, onStep);
    stepOneMove(battle, 3, () => {});
    await settle();
    onStep.mockClear();

    trackStepProgress(battle, onStep);
    battle.play();
    await settle();

    expect(onStep.mock.calls.map((c) => c[0])).toEqual([4, 5, 6, 7, 8, 9, 10, 10]);
    vi.useRealTimers();
  });
});
