import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { TrainerMenu } from './TrainerMenu';
import { LanguageProvider } from '../i18n/LanguageContext';

function renderMenu(onLogout = vi.fn()) {
  render(
    <LanguageProvider>
      <TrainerMenu displayName="Ash" onLogout={onLogout} />
    </LanguageProvider>,
  );
  return { trigger: screen.getByRole('button', { name: 'Ash' }), onLogout };
}

describe('TrainerMenu', () => {
  test('keeps log out out of the title bar until the name is clicked', () => {
    const { trigger } = renderMenu();

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    act(() => trigger.click());

    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  test('logging out closes the menu and calls onLogout', () => {
    const { trigger, onLogout } = renderMenu();
    act(() => trigger.click());

    act(() => screen.getByRole('menuitem').click());

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  test('a pointerdown anywhere else dismisses the menu', () => {
    const { trigger } = renderMenu();
    act(() => trigger.click());

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  test('Escape dismisses the menu and hands focus back to the trigger', () => {
    const { trigger } = renderMenu();
    act(() => trigger.click());

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
