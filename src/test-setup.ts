import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Server tests run in a plain Node environment, where there is no browser to set up.
if (typeof window !== 'undefined') {
  // jsdom does not implement scrolling; the app only uses it to reset the scroll position.
  window.scrollTo = vi.fn();

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
}
