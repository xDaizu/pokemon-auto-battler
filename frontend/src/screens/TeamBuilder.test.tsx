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
          abilities: [{ id: 'shielddust', name: 'Shield Dust', shortDesc: 'Blocks additional effects of moves.' }],
          moves: [
            { id: 'tackle', name: 'Tackle', type: 'Normal', category: 'Physical', basePower: 40, accuracy: 100, learnedAt: 1 },
          ],
        },
      ],
    },
  ],
};

async function openImportPanel() {
  render(
    <LanguageProvider>
      <TeamBuilder onReady={vi.fn()} />
    </LanguageProvider>,
  );
  await screen.findByText('Build Your Team');
  fireEvent.click(screen.getByRole('button', { name: 'Import from Showdown' }));
}

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

    const pikachuChecks = screen.getAllByRole('checkbox', { checked: true });
    expect(pikachuChecks).toHaveLength(3); // Thunder Shock, Quick Attack, Tackle

    // The import panel closes after a successful import.
    expect(screen.queryByPlaceholderText(/Paste a Showdown export/)).not.toBeInTheDocument();
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
