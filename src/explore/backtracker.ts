import { Page } from 'playwright';
import { PageSnapshot } from './types.js';

export class BacktrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacktrackError';
  }
}

export async function createSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    url: window.location.href,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
}

export async function restoreFromSnapshot(page: Page, snapshot: PageSnapshot): Promise<void> {
  const currentUrl = page.url();

  if (currentUrl !== snapshot.url) {
    try {
      await page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
      if (page.url() === snapshot.url) {
        return;
      }
    } catch {}
  }

  if (page.url() !== snapshot.url) {
    try {
      await page.goto(snapshot.url, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      throw new BacktrackError(`Failed to restore to ${snapshot.url}`);
    }
  }

  try {
    await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x: snapshot.scrollX, y: snapshot.scrollY });
  } catch {}
}

export class InteractionGuard {
  async withBacktrack<T>(page: Page, fn: () => Promise<T>): Promise<T | null> {
    const snapshot = await createSnapshot(page);
    try {
      const result = await fn();
      await restoreFromSnapshot(page, snapshot);
      return result;
    } catch {
      try {
        await restoreFromSnapshot(page, snapshot);
      } catch {}
      return null;
    }
  }
}
