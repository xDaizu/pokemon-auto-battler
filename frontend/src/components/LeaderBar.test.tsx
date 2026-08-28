import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeaderBar } from './LeaderBar';
import * as apiClient from '../api/client';
import type { LeaderSummary } from '../api/types';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, fetchLeaders: vi.fn() };
});

// Mirrors the real roster shape (src/config/leaders/index.ts): Brock and
// Misty shipped, Lt. Surge a teaser (available, but its badge is blacked
// out), the rest bare placeholders.
const LEADERS: LeaderSummary[] = [
  { id: 'brock', available: true, label: 'Brock', primaryType: 'Rock', teamSize: 2, levelCap: 11 },
  { id: 'misty', available: true, label: 'Misty', primaryType: 'Water', teamSize: 2, levelCap: 18 },
  {
    id: 'lt-surge',
    available: true,
    label: 'Lt. Surge',
    primaryType: 'Electric',
    teamSize: 3,
    levelCap: 25,
    unreleased: 'teaser',
  },
  { id: 'erika', available: false },
  { id: 'koga', available: false },
  { id: 'sabrina', available: false },
  { id: 'blaine', available: false },
  { id: 'giovanni', available: false },
];

function renderBar(activeLeaderId: string, onSelect = vi.fn()) {
  return render(
    <LanguageProvider>
      <LeaderBar activeLeaderId={activeLeaderId} onSelect={onSelect} />
    </LanguageProvider>,
  );
}

describe('LeaderBar', () => {
  beforeEach(() => {
    vi.mocked(apiClient.fetchLeaders).mockResolvedValue({ leaders: LEADERS });
  });

  test('renders eight buttons, five of them empty locked sockets showing "?"', async () => {
    renderBar('brock');

    const buttons = await screen.findAllByRole('button');
    expect(buttons).toHaveLength(8);

    const locked = buttons.filter((b) => b.textContent === '?');
    expect(locked).toHaveLength(5);
    locked.forEach((b) => {
      expect(b).toBeDisabled();
      expect(b.className).toContain('leader-bar-btn--locked');
    });
  });

  test('shows the active leader by its badge and highlights it as pressed', async () => {
    renderBar('brock');

    const brockButton = await screen.findByRole('button', { name: 'Brock' });
    expect(brockButton).toBeEnabled();
    expect(brockButton.className).toContain('leader-bar-btn--active');
    expect(brockButton.querySelector('img.leader-bar-badge')).not.toBeNull();
  });

  test("a teaser leader's badge is blacked out, unlike a shipped leader's", async () => {
    renderBar('brock');

    const mistyImg = (await screen.findByRole('button', { name: 'Misty' })).querySelector('img');
    expect(mistyImg?.className).not.toContain('teaser-blackout');

    const surgeImg = (await screen.findByRole('button', { name: /Lt\. Surge/ })).querySelector('img');
    expect(surgeImg?.className).toContain('teaser-blackout');
  });

  test('clicking the already-active leader still calls onSelect - App.tsx is what makes it a no-op', async () => {
    const onSelect = vi.fn();
    renderBar('brock', onSelect);

    const brockButton = await screen.findByRole('button', { name: 'Brock' });
    brockButton.click();

    expect(onSelect).toHaveBeenCalledWith('brock');
  });
});
