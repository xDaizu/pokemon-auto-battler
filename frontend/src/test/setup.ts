import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, and ShowdownReplayEmbed builds one
// on mount to scale the fixed-size battle stage to the viewport. Nothing under
// test depends on the measurement (jsdom reports every element as 0x0
// regardless), so a stub that never fires is enough to let the component mount.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Also absent from jsdom; the battle log scrolls itself into view whenever the
// reveal cursor moves. Purely presentational, so a no-op keeps it out of the way.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Same gap as above: jsdom doesn't implement Element.scrollTo either, and the
// battle log panel calls it directly to scroll to its newest line.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

afterEach(cleanup);
