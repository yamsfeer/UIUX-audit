import { Browser } from 'playwright';
import { JourneyResult, JourneyConfig } from './types.js';
import { loadJourney, LoadedJourney } from './loader.js';
import { executeSteps } from './executor.js';
import { resolveUrl } from '../config.js';

export async function runJourney(
  browser: Browser,
  journeyPath: string,
  baseUrl: string,
  defaultViewport?: { width: number; height: number },
): Promise<JourneyResult> {
  const loaded: LoadedJourney = await loadJourney(journeyPath);

  const viewport = loaded.type === 'yaml'
    ? (loaded.config.viewport ?? defaultViewport)
    : defaultViewport;

  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();

  if (viewport) {
    await page.setViewportSize(viewport);
  }

  const journeyName = loaded.type === 'yaml' ? (loaded.config.name || 'unnamed') : 'script';
  console.log(`Running journey "${journeyName}"...`);

  try {
    if (loaded.type === 'yaml') {
      await executeSteps(page, loaded.config.steps, baseUrl);
    } else {
      const ctx = {
        page,
        resolveUrl: (p: string) => resolveUrl(baseUrl, p),
        baseUrl,
      };
      const result = await loaded.fn(ctx);
      const auditPages = Array.isArray(result) ? result : undefined;
      const storageState = await context.storageState();
      await context.close();
      return { storageState, auditPages };
    }

    const storageState = await context.storageState();
    await context.close();
    console.log(`Journey "${journeyName}" completed successfully.`);
    return { storageState };
  } catch (err) {
    await context.close();
    throw err;
  }
}
