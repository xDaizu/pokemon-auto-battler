// Width/format presets for `?as=picture` imports, keyed by the asset's
// `assets/` subdirectory (see docs reference in the image pipeline plan).
// Plain data only, no `node:` imports: this file compiles under both
// tsconfig.app.json (lib ES2023+DOM) and tsconfig.node.json (lib ES2023),
// since `vite/imagePlugin.ts` reads it at config time as well.

export const PORTRAIT_WIDTHS = [320, 512, 768, 1024] as const;
const PORTRAIT_FORMATS = ['avif', 'webp'] as const;

export const BADGE_WIDTHS = [64, 96, 128, 192] as const;
const BADGE_FORMATS = ['webp'] as const;

export interface Ladder {
  widths: readonly number[];
  formats: readonly string[];
  quality?: number;
}

// Covers 181px@3x through 510px@2x for portraits; rungs 1.33-1.6x apart.
// No AVIF for badges: measured, AVIF loses at icon sizes due to its fixed
// container overhead. quality=90 because at 2-5 KB the bytes are irrelevant
// and ringing on hard alpha edges is not.
export const ladders: Record<string, Ladder> = {
  leaders: { widths: PORTRAIT_WIDTHS, formats: PORTRAIT_FORMATS },
  trainers: { widths: PORTRAIT_WIDTHS, formats: PORTRAIT_FORMATS },
  badges: { widths: BADGE_WIDTHS, formats: BADGE_FORMATS, quality: 90 },
};
