// Hand-written: vite-imagetools does not ship a `vite-imagetools/client`
// subpath (its package.json `exports` is only `{types, default}`). TS
// wildcard module declarations match on prefix+suffix, so this only matches
// because the import specifier literally ends in `?as=picture` — inlining
// the ladder into the query string (e.g. `...&as=picture`) would silently
// stop matching. Keep this file free of top-level imports or it stops being
// ambient.
declare module '*?as=picture' {
  const value: import('./types').PictureSource;
  export default value;
}
