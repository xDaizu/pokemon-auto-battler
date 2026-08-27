import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamBuilder } from './TeamBuilder';
import * as apiClient from '../api/client';
import type { RosterResponse } from '../api/types';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    fetchRoster: vi.fn(),
    importTeam: vi.fn(),
  };
});

const ROSTER: RosterResponse = {
  levelCap: 13,
  teamSize: 2,
  natures: [
    { id: 'hardy', name: 'Hardy' },
    { id: 'adamant', name: 'Adamant', plus: 'atk', minus: 'spa' },
    { id: 'modest', name: 'Modest', plus: 'spa', minus: 'atk' },
  ],
  roster: [
    {
      groupId: 'pikachu',
      stages: [
        {
          id: 'pikachu',
          name: 'Pikachu',
          num: 25,
          types: ['Electric'],
          baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
          matchup: 'neutral',
          lineage: ['pikachu'],
          abilities: [
            { id: 'static', name: 'Static', shortDesc: 'May paralyze on contact.' },
            { id: 'lightningrod', name: 'Lightning Rod', shortDesc: 'Draws Electric moves to itself.' },
          ],
          moves: [
            { id: 'thundershock', name: 'Thunder Shock', type: 'Electric', category: 'Special', basePower: 40, accuracy: 100, learnedAt: 1 },
            { id: 'quickattack', name: 'Quick Attack', type: 'Normal', category: 'Physical', basePower: 40, accuracy: 100, learnedAt: 6 },
          ],
        },
      ],
    },
    {
      groupId: 'caterpie',
      stages: [
        {
          id: 'caterpie',
          name: 'Caterpie',
          num: 10,
          types: ['Bug'],
          baseStats: { hp: 45, atk: 30, def: 35, spa: 20, spd: 20, spe: 45 },
          matchup: 'neutral',
          lineage: ['caterpie'],
          abilities: [{ id: 'shielddust', name: 'Shield Dust', shortDesc: 'Blocks additional effects of moves.' }],
          moves: [
            { id: 'tackle', name: 'Tackle', type: 'Normal', category: 'Physical', basePower: 40, accuracy: 100, learnedAt: 1 },
          ],
        },
      ],
    },
  ],
};

// A branching family (Eevee -> Jolteon / Vaporeon), one line per branch, the
// way getRoster shapes it once more than one eeveelution is reachable.
function eeveelutionStage(id: string, name: string, num: number) {
  return {
    id,
    name,
    num,
    types: ['Normal'],
    baseStats: { hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55 },
    matchup: 'neutral' as const,
    lineage: id === 'eevee' ? ['eevee'] : ['eevee', id],
    abilities: [{ id: 'runaway', name: 'Run Away', shortDesc: 'Guarantees escape from wild Pokemon.' }],
    moves: [{ id: 'tackle', name: 'Tackle', type: 'Normal', category: 'Physical' as const, basePower: 40, accuracy: 100, learnedAt: 1 }],
  };
}

// A plain (non-branching) two-stage line, to check the picker represents it
// by its final stage rather than its base.
const EVOLVING_ROSTER: RosterResponse = {
  ...ROSTER,
  roster: [
    ...ROSTER.roster,
    {
      groupId: 'weedle',
      stages: [
        {
          id: 'weedle',
          name: 'Weedle',
          num: 13,
          types: ['Bug', 'Poison'],
          baseStats: { hp: 40, atk: 35, def: 30, spa: 20, spd: 20, spe: 50 },
          matchup: 'neutral',
          lineage: ['weedle'],
          abilities: [{ id: 'shielddust', name: 'Shield Dust', shortDesc: 'Blocks additional effects of moves.' }],
          moves: [{ id: 'poisonsting', name: 'Poison Sting', type: 'Poison', category: 'Physical', basePower: 15, accuracy: 100, learnedAt: 1 }],
        },
        {
          id: 'beedrill',
          name: 'Beedrill',
          num: 15,
          types: ['Bug', 'Poison'],
          baseStats: { hp: 65, atk: 90, def: 40, spa: 45, spd: 80, spe: 75 },
          matchup: 'neutral',
          lineage: ['weedle', 'kakuna', 'beedrill'],
          abilities: [{ id: 'swarm', name: 'Swarm', shortDesc: 'Boosts Bug moves at low HP.' }],
          moves: [{ id: 'furyattack', name: 'Fury Attack', type: 'Normal', category: 'Physical', basePower: 15, accuracy: 85, learnedAt: 1 }],
        },
      ],
    },
  ],
};

const BRANCHING_ROSTER: RosterResponse = {
  ...ROSTER,
  teamSize: 3,
  roster: [
    ...ROSTER.roster,
    {
      groupId: 'eevee:jolteon',
      stages: [eeveelutionStage('eevee', 'Eevee', 133), eeveelutionStage('jolteon', 'Jolteon', 135)],
    },
    {
      groupId: 'eevee:vaporeon',
      stages: [eeveelutionStage('eevee', 'Eevee', 133), eeveelutionStage('vaporeon', 'Vaporeon', 134)],
    },
  ],
};

async function renderBuilder(roster: RosterResponse = ROSTER) {
  vi.mocked(apiClient.fetchRoster).mockResolvedValue(roster);
  render(
    <LanguageProvider>
      <TeamBuilder leaderId="brock" onBack={vi.fn()} onReady={vi.fn()} />
    </LanguageProvider>,
  );
  await screen.findByText('Build Your Team');
}

async function openImportPanel() {
  await renderBuilder();
  fireEvent.click(screen.getByRole('button', { name: 'Import from Showdown' }));
}

describe('TeamBuilder slot tiles and picker/customize flow', () => {
  beforeEach(() => {
    vi.mocked(apiClient.fetchRoster).mockResolvedValue(ROSTER);
  });

  test('an empty slot shows the species picker, scoped to that slot', async () => {
    await renderBuilder();
    expect(await screen.findByText('Choose Pokémon 1')).toBeInTheDocument();
    expect(screen.getByTitle('Pikachu')).toBeInTheDocument();
  });

  test('picking a species advances to the Customize panel and updates the tile', async () => {
    await renderBuilder();
    fireEvent.click(await screen.findByTitle('Pikachu'));

    expect(screen.queryByText('Choose Pokémon 1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pokémon 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Pokémon' })).toBeInTheDocument();
    // The tile itself now shows the species name instead of a plain "+".
    expect(screen.getByTitle('Pokémon 1')).toHaveTextContent('Pikachu');
  });

  test('clicking remove clears the slot and returns to the picker, staying on the same slot', async () => {
    await renderBuilder();
    fireEvent.click(await screen.findByTitle('Pikachu'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pokémon' }));

    expect(await screen.findByText('Choose Pokémon 1')).toBeInTheDocument();
    expect(screen.getByTitle('Pokémon 1')).not.toHaveTextContent('Pikachu');
  });

  test('locked slots beyond teamSize are disabled and inert', async () => {
    await renderBuilder();
    const locked = screen.getAllByTitle('Locked for this challenge');
    expect(locked).toHaveLength(4); // teamSize: 2, out of 6 tiles

    fireEvent.click(locked[0]!);
    // Still on slot 1's picker - clicking a locked tile did nothing.
    expect(screen.getByText('Choose Pokémon 1')).toBeInTheDocument();
    locked.forEach((tile) => expect(tile).toBeDisabled());
  });

  test('a species already used in another slot is disabled in the other slot\'s picker', async () => {
    await renderBuilder();
    fireEvent.click(await screen.findByTitle('Pikachu'));

    fireEvent.click(screen.getByTitle('Pokémon 2'));
    expect(await screen.findByText('Choose Pokémon 2')).toBeInTheDocument();
    // Blocked species show the duplicate-blocked reason as their title instead of their name.
    expect(screen.getByTitle('Your team cannot contain the same Pokemon twice.')).toBeDisabled();
  });
});

describe('TeamBuilder evolution family rules', () => {
  test('the picker represents a line by its final stage, not its base', async () => {
    await renderBuilder(EVOLVING_ROSTER);
    // Beedrill (the final stage), not Weedle (the base), is the tile shown.
    expect(screen.getByTitle('Beedrill')).toBeInTheDocument();
    expect(screen.queryByTitle('Weedle')).not.toBeInTheDocument();
  });

  test('picking that line lands on its final stage by default, with the stage row offering earlier ones', async () => {
    await renderBuilder(EVOLVING_ROSTER);
    fireEvent.click(await screen.findByTitle('Beedrill'));

    expect(screen.getByTitle('Pokémon 1')).toHaveTextContent('Beedrill');
    expect(screen.getByRole('button', { name: /Weedle/ })).toBeInTheDocument();
  });

  test('sibling branches of a branching family (Jolteon/Vaporeon) can both be on the team', async () => {
    await renderBuilder(BRANCHING_ROSTER);
    fireEvent.click(await screen.findByTitle('Jolteon'));

    fireEvent.click(screen.getByTitle('Pokémon 2'));
    expect(await screen.findByText('Choose Pokémon 2')).toBeInTheDocument();
    // Vaporeon shares only the unpicked Eevee ancestor with Jolteon, so it's
    // still selectable.
    expect(screen.getByTitle('Vaporeon')).toBeEnabled();
  });

  test('a shared pre-evolution (Eevee) blocks every branch descending from it, across slots', async () => {
    await renderBuilder(BRANCHING_ROSTER);
    fireEvent.click(await screen.findByTitle('Jolteon'));
    // Fall back to the line's base stage via the stage row.
    fireEvent.click(screen.getByRole('button', { name: /Eevee/ }));

    fireEvent.click(screen.getByTitle('Pokémon 2'));
    expect(await screen.findByText('Choose Pokémon 2')).toBeInTheDocument();
    // Every stage of both the Jolteon and Vaporeon lines runs through Eevee,
    // so both are blocked now that Eevee itself is on the team.
    const blocked = screen.getAllByTitle('Your team cannot contain the same Pokemon twice.');
    expect(blocked).toHaveLength(2);
    blocked.forEach((tile) => expect(tile).toBeDisabled());
  });

  test('picking the exact same final stage twice still shows the plain duplicate reason', async () => {
    await renderBuilder(BRANCHING_ROSTER);
    fireEvent.click(await screen.findByTitle('Jolteon'));

    fireEvent.click(screen.getByTitle('Pokémon 2'));
    expect(await screen.findByText('Choose Pokémon 2')).toBeInTheDocument();
    expect(screen.getByTitle('Your team cannot contain the same Pokemon twice.')).toBeDisabled();
  });
});

describe('TeamBuilder import from Showdown', () => {
  beforeEach(() => {
    vi.mocked(apiClient.fetchRoster).mockResolvedValue(ROSTER);
  });

  test('shows the backend validation error next to the Import button', async () => {
    vi.mocked(apiClient.importTeam).mockRejectedValue(new Error('Pokemon 1: must be Level 13.'));

    await openImportPanel();
    fireEvent.change(screen.getByPlaceholderText(/Paste a Showdown export/), {
      target: { value: 'Pikachu\nLevel: 50\n- Thunder Shock\n\nCaterpie\nLevel: 13\n- Tackle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Pokemon 1: must be Level 13.')).toBeInTheDocument();
    // The import panel stays open with the offending text so the user can fix it.
    expect(screen.getByPlaceholderText(/Paste a Showdown export/)).toBeInTheDocument();
  });

  test('populates both slots and enables Battle! on a successful import', async () => {
    vi.mocked(apiClient.importTeam).mockResolvedValue({
      selections: [
        { stageId: 'pikachu', ability: 'static', nature: 'adamant', moves: ['thundershock', 'quickattack'] },
        { stageId: 'caterpie', ability: 'shielddust', nature: 'hardy', moves: ['tackle'] },
      ],
    });

    await openImportPanel();
    fireEvent.change(screen.getByPlaceholderText(/Paste a Showdown export/), {
      target: { value: 'Pikachu\nLevel: 13\n- Thunder Shock\n- Quick Attack\n\nCaterpie\nLevel: 13\n- Tackle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Battle!' })).toBeEnabled();
    });

    // The import panel closes after a successful import.
    expect(screen.queryByPlaceholderText(/Paste a Showdown export/)).not.toBeInTheDocument();

    // Import lands on slot 1's Customize panel, showing Pikachu's two moves checked.
    expect(screen.getByRole('heading', { name: 'Pokémon 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2); // Thunder Shock, Quick Attack

    // Switching to slot 2 shows Caterpie's single checked move.
    fireEvent.click(screen.getByTitle('Pokémon 2'));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1); // Tackle
  });

  test('surfaces an unparsable-text error from the backend', async () => {
    vi.mocked(apiClient.importTeam).mockRejectedValue(new Error('Could not parse that as a Showdown export.'));

    await openImportPanel();
    fireEvent.change(screen.getByPlaceholderText(/Paste a Showdown export/), {
      target: { value: 'not a showdown export at all' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Could not parse that as a Showdown export.')).toBeInTheDocument();
  });
});
