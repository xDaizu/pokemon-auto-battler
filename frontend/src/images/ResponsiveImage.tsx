import type { CSSProperties } from 'react';
import type { PictureSource } from './types';

interface ResponsiveImageProps {
  image: PictureSource;
  alt: string;
  /** Mandatory, no default: a wrong guess here silently serves the largest variant. */
  sizes: string;
  className?: string;
  ariaHidden?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
  decoding?: 'sync' | 'async' | 'auto';
  loading?: 'lazy' | 'eager';
}

// No box: every existing CSS rule at a call site keeps targeting the inner
// `<img>` unchanged, so no call site needs a CSS edit to adopt this
// component. Module-level so it isn't reallocated on every render.
const PICTURE_STYLE: CSSProperties = { display: 'contents' };

/**
 * Renders a `?as=picture` payload (see `vite/imagePlugin.ts`) as a
 * `<picture>`: one `<source>` per format except the last, whose srcset
 * becomes the `<img>`'s own srcset - imagetools-core treats the last format
 * as `fallbackFormat` and `img.src` as its largest variant, so the `<img>`
 * needs that srcset too or it falls back to the biggest file for every
 * client that reaches it.
 */
export function ResponsiveImage({
  image,
  alt,
  sizes,
  className,
  ariaHidden,
  fetchPriority,
  decoding = 'async',
  loading,
}: ResponsiveImageProps) {
  const formats = Object.keys(image.sources);
  const fallbackFormat = formats[formats.length - 1];

  return (
    <picture style={PICTURE_STYLE}>
      {formats.slice(0, -1).map((format) => (
        <source key={format} type={`image/${format}`} srcSet={image.sources[format]} sizes={sizes} />
      ))}
      <img
        src={image.img.src}
        srcSet={fallbackFormat ? image.sources[fallbackFormat] : undefined}
        sizes={sizes}
        width={image.img.w}
        height={image.img.h}
        className={className}
        alt={alt}
        aria-hidden={ariaHidden}
        fetchPriority={fetchPriority}
        decoding={decoding}
        loading={loading}
      />
    </picture>
  );
}
