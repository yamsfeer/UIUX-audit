import { Page } from 'playwright';

const FALLBACK_WAIT_MS = 1000;

/**
 * Navigate to a URL with smart wait strategy.
 * Tries 'networkidle' first (best for production sites).
 * Falls back to 'load' + short wait when networkidle times out
 * (handles dev servers with persistent connections like Vite HMR).
 */
export async function gotoPage(
  page: Page,
  url: string,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30000;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout });
    await page.waitForTimeout(FALLBACK_WAIT_MS);
  }
}

/**
 * Go back with smart wait strategy (same fallback pattern).
 */
export async function goBack(
  page: Page,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10000;
  try {
    await page.goBack({ waitUntil: 'networkidle', timeout });
  } catch {
    try {
      await page.goBack({ waitUntil: 'load', timeout });
      await page.waitForTimeout(FALLBACK_WAIT_MS);
    } catch {
      // goBack may fail if no history; caller handles this
    }
  }
}
