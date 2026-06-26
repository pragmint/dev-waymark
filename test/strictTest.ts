import { test as base, expect } from '@playwright/test';

// Wrapper around Playwright's `test` that fails the test on any uncaught
// page-level error (the kind that shows up in the browser console as
// "Uncaught TypeError: ..."). The default fixture silently swallows these.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on('pageerror', err => errors.push(err));
    await use(page);
    if (errors.length > 0) {
      const summary = errors.map(e => e.stack ?? e.message).join('\n\n');
      throw new Error(`Uncaught page errors during test:\n\n${summary}`);
    }
  },
});

export { expect };
