import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom does not implement scrolling; the app only uses it to reset the scroll position.
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  localStorage.clear();
});
