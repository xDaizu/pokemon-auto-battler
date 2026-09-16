import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ResponsiveImage } from './ResponsiveImage';
import type { PictureSource } from './types';

// Mirrors a real imagetools `?as=picture` payload: two formats, avif then
// webp, with img.src/w/h pinned to the fallback format's largest variant.
const FIXTURE: PictureSource = {
  sources: {
    avif: '/a-320.avif 320w, /a-1024.avif 1024w',
    webp: '/a-320.webp 320w, /a-1024.webp 1024w',
  },
  img: { src: '/a-1024.webp', w: 1024, h: 2000 },
};

describe('ResponsiveImage', () => {
  test('renders one <source> per format except the last, in order', () => {
    const { container } = render(<ResponsiveImage image={FIXTURE} alt="" sizes="50vw" />);

    const sources = container.querySelectorAll('source');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.getAttribute('type')).toBe('image/avif');
    expect(sources[0]?.getAttribute('srcset')).toBe(FIXTURE.sources.avif);
  });

  test('sizes is present on both the <source> and the <img>', () => {
    const { container } = render(<ResponsiveImage image={FIXTURE} alt="" sizes="50vw" />);

    expect(container.querySelector('source')?.getAttribute('sizes')).toBe('50vw');
    expect(container.querySelector('img')?.getAttribute('sizes')).toBe('50vw');
  });

  test('the <img> carries the last format as its own srcset, plus a fallback src, width and height', () => {
    const { container } = render(<ResponsiveImage image={FIXTURE} alt="" sizes="50vw" />);

    const img = container.querySelector('img');
    expect(img?.getAttribute('srcset')).toBe(FIXTURE.sources.webp);
    expect(img?.getAttribute('src')).toBe(FIXTURE.img.src);
    expect(img?.getAttribute('width')).toBe('1024');
    expect(img?.getAttribute('height')).toBe('2000');
  });

  test('the <picture> is display: contents, so it generates no box', () => {
    const { container } = render(<ResponsiveImage image={FIXTURE} alt="" sizes="50vw" />);

    expect(container.querySelector('picture')).toHaveStyle({ display: 'contents' });
  });

  test('className lands on the <img>, never the <picture>', () => {
    const { container } = render(
      <ResponsiveImage image={FIXTURE} alt="" sizes="50vw" className="teaser-blackout" />,
    );

    expect(container.querySelector('img')?.className).toBe('teaser-blackout');
    expect(container.querySelector('picture')?.className).toBe('');
  });

  test('passes through alt, ariaHidden, fetchPriority, decoding and loading', () => {
    const { container } = render(
      <ResponsiveImage
        image={FIXTURE}
        alt="Brock"
        sizes="50vw"
        ariaHidden
        fetchPriority="high"
        loading="lazy"
      />,
    );

    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('Brock');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('fetchpriority')).toBe('high');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });
});
