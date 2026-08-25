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

  // Correctness-critical: the header must not grey a Pokémon out before the
  // line that faints it has been revealed.
  test('marks a Pokémon fainted only once the faint line is revealed', async () => {
    const { container } = await renderBattle();
    await tick();
    expect(container.querySelector('.battle-mon.fainted')).toBeNull();

    await tick();
    const fainted = container.querySelector('.battle-mon.fainted');
    expect(fainted).not.toBeNull();
    expect(fainted).toHaveTextContent('Onix');
  });

  test('reaching the end reveals the outcome banner', async () => {
    await renderBattle();
    await tick(2);
    expect(screen.getByText(/You defeated Brock/i)).toBeInTheDocument();
  });
});
