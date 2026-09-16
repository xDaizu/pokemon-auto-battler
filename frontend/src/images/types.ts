// Owned locally rather than imported from imagetools-core: importing its
// `Picture` type would drag imagetools-core (and sharp's node typings) into
// the app's tsconfig.app.json program. Shape verified against
// imagetools-core's `pictureFormat` output.
export interface PictureSource {
  /** Key is format (e.g. "avif", "webp"), value is a srcset string. */
  sources: Record<string, string>;
  img: {
    src: string;
    w: number;
    h: number;
  };
}
