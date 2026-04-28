import { Page, Browser } from 'playwright';
import { ViewportConfig, ScreenshotInfo } from '../checks/types.js';
import { StorageState } from '../journey/types.js';
import { resolveUrl } from '../config.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ScreenshotResult {
  screenshots: ScreenshotInfo[];
  tempDir: string;
  persistent: boolean;
}

export async function captureScreenshots(
  browser: Browser,
  url: string,
  viewports: ViewportConfig[],
  extraPages?: string[],
  outputDir?: string,
  storageState?: StorageState
): Promise<ScreenshotResult> {
  let dir: string;
  let persistent: boolean;

  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    dir = outputDir;
    persistent = true;
  } else {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uiux-audit-'));
    persistent = false;
  }

  const screenshots: ScreenshotInfo[] = [];
  const allUrls = [url, ...(extraPages || [])];

  const context = await browser.newContext({
    locale: 'zh-CN',
    storageState: storageState || undefined,
  });
  const page = await context.newPage();

  for (const pageUrl of allUrls) {
    const resolvedUrl = resolveUrl(url, pageUrl);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(resolvedUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);

      // Viewport screenshot
      const viewportFile = path.join(dir, `${safeName(pageUrl)}-${viewport.name}-viewport.png`);
      await page.screenshot({ path: viewportFile });
      screenshots.push({ pageUrl, viewport, state: 'viewport', path: viewportFile });

      // Full page screenshot
      const fullPageFile = path.join(dir, `${safeName(pageUrl)}-${viewport.name}-fullpage.png`);
      await page.screenshot({ path: fullPageFile, fullPage: true });
      screenshots.push({ pageUrl, viewport, state: 'fullpage', path: fullPageFile });

      // Interactive overlay screenshots
      const overlayScreenshots = await captureOverlayStates(page, pageUrl, viewport, dir);
      screenshots.push(...overlayScreenshots);
    }
  }

  await context.close();
  return { screenshots, tempDir: dir, persistent };
}

async function captureOverlayStates(
  page: Page,
  pageUrl: string,
  viewport: ViewportConfig,
  tempDir: string
): Promise<ScreenshotInfo[]> {
  const results: ScreenshotInfo[] = [];

  const selectors = [
    '[aria-haspopup="dialog"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="listbox"]',
    '[data-modal]',
    '[data-dropdown]',
    '[data-overlay]',
  ].join(', ');

  const triggers = await page.$$(selectors);
  for (let i = 0; i < Math.min(triggers.length, 3); i++) {
    try {
      await triggers[i].click();
      await page.waitForTimeout(300);
      const filePath = path.join(tempDir, `${safeName(pageUrl)}-${viewport.name}-overlay-${i}.png`);
      await page.screenshot({ path: filePath });
      results.push({ pageUrl, viewport, state: `overlay-${i}`, path: filePath });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } catch {
      // Skip if click fails or overlay doesn't appear
    }
  }

  return results;
}

export async function cleanupScreenshots(tempDir: string, persistent = false): Promise<void> {
  if (persistent) return;
  await fs.rm(tempDir, { recursive: true, force: true });
}

function safeName(url: string): string {
  return url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
}
