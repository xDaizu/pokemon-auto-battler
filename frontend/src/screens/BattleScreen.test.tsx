import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BattleScreen } from './BattleScreen';
import { runBattle } from '../api/client';
import { FALLBACK_TURN_MS } from '../battle/replayLog';
import type { BattleResult, PlayerPokemonSelection } from '../api/types';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, runBattle: vi.fn(), fetchMoveDetail: vi.fn() };
});

// Sidesteps the provider's session fetch entirely - BattleScreen only reads
// `user.displayName` off it, and a real AuthProvider would drag an async
// bootstrap into every test here for nothing.
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'ash', displayName: 'Ash' } }),
}));

function member(name: string, num: number) {
  return {
    species: name,
    name,
    num,
    level: 13,
    types: ['Normal'],
    ability: 'Overgrow',
    baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
  };
}

/** Two Pokémon a side, three turn buckets: the send-out, a full exchange, and
 * a finishing move that faints Onix. Turn 2 carries two complete moves so a
 * cursor can be parked between them. */
const RESULT: BattleResult = {
  turns: [
    {
      turn: 0,
      lines: [
        'gametype|doubles',
        'switch|p1a: Bulbasaur|Bulbasaur, L13|38/38',
        'switch|p2a: Onix|Onix, L13|40/40',
      ],
    },
    {
      turn: 1,
      lines: [
        'move|p1a: Bulbasaur|Vine Whip|p2a: Onix',
        '-supereffective|p2a: Onix',
        '-damage|p2a: Onix|8/40',
        'move|p2a: Onix|Tackle|p1a: Bulbasaur',
        '-damage|p1a: Bulbasaur|30/38',
      ],
    },
    {
      turn: 2,
      lines: ['move|p1a: Bulbasaur|Razor Leaf|p2a: Onix', 'faint|p2a: Onix', 'win|Red'],
    },
  ],
  tie: false,
  winner: 'Red',
  outcome: 'player',
  player: { label: 'Red', pokemon: [member('Bulbasaur', 1), member('Squirtle', 7)] },
  rival: { label: 'Brock', pokemon: [member('Onix', 95), member('Geodude', 74)] },
  moveTargets: { vinewhip: 'normal', tackle: 'normal', razorleaf: 'allAdjacentFoes' },
  battleId: 1,
};

const SELECTIONS = [] as unknown as PlayerPokemonSelection[];

/** Renders and settles the battle fetch. Fake timers are already installed, so
 * the resolved promise has to be flushed by hand rather than via `waitFor`. */
async function renderBattle() {
  vi.mocked(runBattle).mockResolvedValue(RESULT);
  const view = render(
    <LanguageProvider>
      <BattleScreen selections={SELECTIONS} onRebuild={() => {}} />
    </LanguageProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/** Advances the fallback reveal timer by whole turns. */
async function tick(turns = 1) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_TURN_MS.fast);
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem('pokemon-auto-battler:lang', 'en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('BattleScreen reveal', () => {
  // The whole point of seeding the cursor past the send-out bucket: without
  // it the log sits visibly empty under an already-drawn battlefield until
  // whichever clock takes over gets around to its first tick.
  test('shows the send-out bucket immediately, without waiting for a tick', async () => {
    await renderBattle();
    // Both sides' send-outs, in full - the whole bucket, not a first line.
    expect(screen.getAllByText(/enters the battlefield/i)).toHaveLength(2);
  });

  test('does not reveal a turn that has not been reached yet', async () => {
    await renderBattle();
    expect(screen.queryByText('Vine Whip')).not.toBeInTheDocument();
    expect(screen.queryByText(/Turn 1/)).not.toBeInTheDocument();

    await tick();
    expect(screen.getByText('Vine Whip')).toBeInTheDocument();
  });

  test('reveals only as far as the cursor has reached, leaving later turns hidden', async () => {
    await renderBattle();
    await tick();

    // Turn 1 is on screen; turn 2's move must not have leaked in with it.
    expect(screen.getByText('Vine Whip')).toBeInTheDocument();
    expect(screen.queryByText('Razor Leaf')).not.toBeInTheDocument();
  });

  test('reaching the end reveals the outcome banner', async () => {
    await renderBattle();
    await tick(2);
    expect(screen.getByText(/You defeated Brock/i)).toBeInTheDocument();
  });
});

const control = (name: RegExp) => screen.getByRole('button', { name });

describe('BattleScreen controls', () => {
  test('renders exactly the four playback controls', async () => {
    await renderBattle();
    expect(control(/^Pause$/)).toBeInTheDocument();
    expect(control(/^Next Move$/)).toBeInTheDocument();
    expect(control(/^Play$/)).toBeInTheDocument();
    expect(control(/^Skip to End$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fast Forward/i })).not.toBeInTheDocument();
  });

  test('starts playing, with Play lit and Pause available to stop it', async () => {
    await renderBattle();
    expect(control(/^Play$/)).toHaveAttribute('aria-pressed', 'true');
    expect(control(/^Pause$/)).toHaveAttribute('aria-pressed', 'false');
    expect(control(/^Pause$/)).toBeEnabled();
  });

  // "Is on if the battle is not playing. Cannot be re-clicked once active."
  test('Pause lights up and locks once the battle is stopped', async () => {
    await renderBattle();
    act(() => control(/^Pause$/).click());

    const pause = control(/^Pause$/);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    expect(pause).toBeDisabled();
    expect(pause).toHaveClass('active');
    expect(control(/^Play$/)).toHaveAttribute('aria-pressed', 'false');
  });

  test('Play toggles back to paused when clicked a second time', async () => {
    await renderBattle();
    act(() => control(/^Play$/).click());
    expect(control(/^Play$/)).toHaveAttribute('aria-pressed', 'false');
    expect(control(/^Pause$/)).toBeDisabled();

    act(() => control(/^Play$/).click());
    expect(control(/^Play$/)).toHaveAttribute('aria-pressed', 'true');
    expect(control(/^Pause$/)).toBeEnabled();
  });

  test('pausing actually stops the reveal clock', async () => {
    await renderBattle();
    act(() => control(/^Pause$/).click());
    await tick(2);
    expect(screen.queryByText('Vine Whip')).not.toBeInTheDocument();
  });

  test('Step is only offered while the battle is stopped', async () => {
    await renderBattle();
    expect(control(/^Next Move$/)).toBeDisabled();

    act(() => control(/^Pause$/).click());
    expect(control(/^Next Move$/)).toBeEnabled();
  });

  // The requirement, end to end: one click resolves one move *and* everything
  // it caused, and stops there. (jsdom never loads the Showdown CDN, so this
  // exercises the fallback branch - the animated widget branch is covered by
  // stepMove.test.ts and by the manual check.)
  test('Step reveals exactly one move and all of its effects', async () => {
    await renderBattle();
    act(() => control(/^Pause$/).click());
    act(() => control(/^Next Move$/).click());

    // Bulbasaur's Vine Whip, with the super-effective note and the damage it
    // dealt - the whole resolution, not just the "used move" line.
    expect(screen.getByText('Vine Whip')).toBeInTheDocument();
    expect(screen.getByText(/It's super effective/i)).toBeInTheDocument();
    expect(screen.getByText(/took damage/i)).toBeInTheDocument();

    // ...and nothing of Onix's reply, which is the next move.
    expect(screen.queryByText('Tackle')).not.toBeInTheDocument();
  });

  test('stepping again picks up at the next move', async () => {
    await renderBattle();
    act(() => control(/^Pause$/).click());
    act(() => control(/^Next Move$/).click());
    act(() => control(/^Next Move$/).click());

    expect(screen.getByText('Tackle')).toBeInTheDocument();
    expect(screen.queryByText('Razor Leaf')).not.toBeInTheDocument();
  });

  // Regression guard: skipping used to leave `battleOver` false forever, which
  // stranded the rematch button disabled after the battle had plainly ended.
  test('Skip to End reveals the whole battle and offers a rematch', async () => {
    await renderBattle();
    act(() => control(/^Skip to End$/).click());

    expect(screen.getByText('Razor Leaf')).toBeInTheDocument();
    expect(screen.getByText(/You defeated Brock/i)).toBeInTheDocument();
    expect(control(/^Fight Again$/)).toBeEnabled();
  });
});
