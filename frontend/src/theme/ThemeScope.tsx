import type { CSSProperties, ReactNode } from 'react';
import { leaderThemes } from './leaderThemes.js';

/**
 * Scopes the --color-primary / -dim / -soft tokens (registered in index.css
 * via `@theme inline`) to a gym leader's palette for everything rendered
 * inside it. Components author against the `bg-primary` / `text-primary`
 * Tailwind utilities and never need to know which leader is active.
 *
 * Falls back to the default --accent-derived primary (set in index.css)
 * when `leaderId` doesn't match a known theme, so an unthemed or
 * not-yet-defined leader degrades gracefully instead of breaking.
 */
export function ThemeScope({ leaderId, children }: { leaderId: string; children: ReactNode }) {
  const theme = leaderThemes[leaderId];
  if (!theme) return <>{children}</>;

  const style = {
    '--color-primary': theme.primary,
    '--color-primary-dim': `color-mix(in srgb, ${theme.primary} 65%, black)`,
    '--color-primary-soft': `color-mix(in srgb, ${theme.primary} 20%, var(--panel))`,
  } as CSSProperties;

  return <div style={style}>{children}</div>;
}
