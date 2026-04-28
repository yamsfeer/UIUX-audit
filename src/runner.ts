import { chromium, Browser } from 'playwright';
import { AuditConfig, CheckResult } from './checks/types.js';
import { runAccessibilityCheck } from './checks/accessibility.js';
import { runLayoutCheck } from './checks/layout.js';
import { captureScreenshots, cleanupScreenshots } from './visual/screenshot.js';
import { runVisualReview } from './visual/reviewer.js';
import { loadDesignSpec } from './visual/design-spec.js';
import { buildReport, formatJson, formatMarkdown, formatTable } from './report/formatter.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function formatTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

async function resolveOutputDir(config: AuditConfig): Promise<string | undefined> {
  if (!config.outputDir) return undefined;

  if (config.timestamp) {
    const subdir = formatTimestamp(new Date().toISOString());
    const full = path.join(config.outputDir, subdir);
    await fs.mkdir(full, { recursive: true });
    return full;
  }

  await fs.mkdir(config.outputDir, { recursive: true });
  return config.outputDir;
}

export async function runAudit(config: AuditConfig): Promise<void> {
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const results: CheckResult[] = [];

    // Programmatic checks - reuse one page
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: config.viewports[0].width, height: config.viewports[0].height });
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 30000 });

    if (!config.noA11y) {
      console.log('Running accessibility check...');
      results.push(await runAccessibilityCheck(page));
    }

    if (!config.noLayout) {
      console.log('Running layout check...');
      results.push(await runLayoutCheck(page));
    }

    await context.close();

    // Resolve output directory before visual review (screenshots need it)
    const outDir = await resolveOutputDir(config);
    let savedScreenshotDir: string | undefined;

    // Visual review
    if (config.visual) {
      const screenshotDir = outDir ? path.join(outDir, 'screenshots') : undefined;
      if (!config.modelUrl || !config.modelKey) {
        console.error('Error: --model-url and --model-key are required when --visual is enabled.');
        console.error('Set UIUX_AUDIT_MODEL_URL and UIUX_AUDIT_MODEL_KEY environment variables or pass them as options.');
        process.exit(1);
      }

      console.log('Capturing screenshots...');
      const { screenshots, tempDir, persistent } = await captureScreenshots(
        browser,
        config.url,
        config.viewports,
        config.pages,
        screenshotDir
      );

      console.log(`Captured ${screenshots.length} screenshots, running visual review...`);

      const designSpec = config.designSpec ? await loadDesignSpec(config.designSpec) : undefined;
      const visualIssues = await runVisualReview(screenshots, {
        modelUrl: config.modelUrl,
        modelKey: config.modelKey,
        modelName: config.modelName,
        designSpec,
      });

      results.push({
        check: 'visual',
        issues: visualIssues,
        duration: 0,
      });

      await cleanupScreenshots(tempDir, persistent);
      if (screenshotDir) savedScreenshotDir = screenshotDir;
    }

    // Build and output report
    const report = buildReport(config.url, results);

    let output: string;
    switch (config.output) {
      case 'json':
        output = formatJson(report);
        break;
      case 'markdown':
        output = formatMarkdown(report);
        break;
      case 'table':
      default:
        output = formatTable(report);
        break;
    }

    if (outDir) {
      const ext = config.output === 'json' ? 'json' : config.output === 'markdown' ? 'md' : 'txt';
      const reportPath = path.join(outDir, `report.${ext}`);
      await fs.writeFile(reportPath, output, 'utf-8');
      console.log(`Report written to ${reportPath}`);
      if (savedScreenshotDir) {
        console.log(`Screenshots saved to ${savedScreenshotDir}`);
      }
    } else if (config.outputFile) {
      await fs.writeFile(config.outputFile, output, 'utf-8');
      console.log(`Report written to ${config.outputFile}`);
    } else {
      console.log(output);
    }

  } finally {
    await browser?.close();
  }
}
