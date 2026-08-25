import { describe, test, expect, vi } from 'vitest';
import { stepOneMove, type SteppableBattle } from './stepMove';

/**
 * Stands in for the widget's own `Battle`, reproducing the two behaviours
 * `stepOneMove` actually depends on (both verified against battle.js):
 *
 *  - `nextStep` lives on the **prototype**, and its continuation re-enters
 *    through `this.nextStep()` - a dynamic lookup, which is what lets an
 *    own-property shadow intercept later batches.
 *  - that continuation is **asynchronous**, standing in for the real
 *    `animations.done()` callback that fires when a batch finishes animating.
 *
 * Each call consumes one queue entry; `queue` is a plain length so a "batch"
 * here is one step, which is all the stopping logic cares about.
 */
class FakeBattle implements SteppableBattle {
  currentStep = 0;
  atQueueEnd = false;
  paused = true;
  pauseCalls = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly queueLength: number) {}

  play() {
    this.paused = false;
    this.nextStep();
  }

  pause() {
    this.paused = true;
    this.pauseCalls++;
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
  }

  nextStep() {
    if (this.paused || this.atQueueEnd) return;
    if (this.currentStep >= this.queueLength) {
      this.atQueueEnd = true;
      return;
    }
    this.currentStep++;
    // The real loop schedules its own continuation once the batch's animation
    // resolves; anything that reaches this instance property later - including
    // a shadow installed after `play()` - is what runs.
    this.pending = setTimeout(() => this.nextStep(), 1);
  }
}

/** Runs the fake's queued continuations to a standstill. */
async function settle() {
  await vi.advanceTimersByTimeAsync(50);
}

describe('stepOneMove', () => {
  test('stops exactly at the target step, not before or past it', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(20);
    const onLanded = vi.fn();

    stepOneMove(battle, 5, onLanded);
    await settle();

    expect(battle.currentStep).toBe(5);
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(battle.paused).toBe(true);
    vi.useRealTimers();
  });

  // The shadow is an own property over a prototype method; if it were left
  // installed, the next step would capture *it* as "the original" and wrap a
  // wrapper - each step compounding the last.
  test('restores the prototype method once it lands', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(20);

    stepOneMove(battle, 3, () => {});
    await settle();

    expect(Object.prototype.hasOwnProperty.call(battle, 'nextStep')).toBe(false);
    vi.useRealTimers();
  });

  test('steps repeatedly, each landing on its own target', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(20);

    for (const target of [4, 9, 11]) {
      stepOneMove(battle, target, () => {});
      await settle();
      expect(battle.currentStep).toBe(target);
    }
    vi.useRealTimers();
  });

  test('stops at the end of the queue rather than spinning past it', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(6);
    const onLanded = vi.fn();

    stepOneMove(battle, 999, onLanded);
    await settle();

    expect(battle.atQueueEnd).toBe(true);
    expect(battle.currentStep).toBe(6);
    expect(onLanded).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('lands immediately when the target has already been passed', () => {
    const battle = new FakeBattle(20);
    battle.currentStep = 8;
    const onLanded = vi.fn();

    stepOneMove(battle, 5, onLanded);

    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(battle.pauseCalls).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(battle, 'nextStep')).toBe(false);
  });

  test('pauses once per step, not once per animated batch', async () => {
    vi.useFakeTimers();
    const battle = new FakeBattle(20);

    stepOneMove(battle, 7, () => {});
    await settle();

    expect(battle.pauseCalls).toBe(1);
    vi.useRealTimers();
  });
});
