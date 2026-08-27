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

const LEADERS: LeaderSummary[] = [
  { id: 'brock', available: true, label: 'Brock', primaryType: 'Rock', teamSize: 2, levelCap: 13 },
  { id: 'misty', available: false },
  { id: 'lt-surge', available: false },
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

  test('renders eight buttons, seven of them disabled and showing "?"', async () => {
    renderBar('brock');

    const buttons = await screen.findAllByRole('button');
    expect(buttons).toHaveLength(8);

    const locked = buttons.filter((b) => b.textContent === '?');
    expect(locked).toHaveLength(7);
    locked.forEach((b) => expect(b).toBeDisabled());
  });

  test('shows the active leader by name and highlights it', async () => {
    renderBar('brock');

    const brockButton = await screen.findByRole('button', { name: 'Brock' });
    expect(brockButton).toBeEnabled();
    expect(brockButton.className).toContain('leader-bar-btn--active');
  });

  test('clicking the already-active leader still calls onSelect - App.tsx is what makes it a no-op', async () => {
    const onSelect = vi.fn();
    renderBar('brock', onSelect);

    const brockButton = await screen.findByRole('button', { name: 'Brock' });
    brockButton.click();

    expect(onSelect).toHaveBeenCalledWith('brock');
  });
});
