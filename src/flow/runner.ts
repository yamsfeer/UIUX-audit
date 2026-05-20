import { Browser, BrowserContext } from 'playwright';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { FlowConfig, FlowResult, FlowCheckpointResult, FlowStepError, FlowStep } from './types.js';
import { JourneyStep, StorageState } from '../journey/types.js';
import { loadFlow } from './loader.js';
import { runJourney } from '../journey/runner.js';
import { executeSteps, executeStep } from '../journey/executor.js';
import { resolveUrl } from '../config.js';
import { runAccessibilityCheck } from '../checks/accessibility.js';
import { runLayoutCheck } from '../checks/layout.js';
import { CheckResult, ScreenshotInfo, ViewportConfig } from '../checks/types.js';
import { getStepType } from '../journey/executor.js';

interface FlowRunOptions {
  storageState?: StorageState;
  viewports: ViewportConfig[];
  noA11y: boolean;
  noLayout: boolean;
  visual: boolean;
  modelUrl?: string;
  modelKey?: string;
  modelName: string;
  outputDir?: string;
}

export async function runFlow(
  browser: Browser,
  flowPath: string,
  baseUrl: string,
  options: FlowRunOptions,
): Promise<FlowResult> {
  const startTime = Date.now();
  const loaded = await loadFlow(flowPath);

  const config = loaded.type === 'yaml' ? loaded.config : undefined;
  const flowName = config?.name || 'unnamed';
  const viewport = config?.viewport
    ? { ...config.viewport, name: 'flow' }
    : options.viewports[0];

  console.log(`Running flow "${flowName}"...`);

  let storageState = options.storageState;

  // Run setup phase
  if (config?.setup) {
    if ('journey' in config.setup) {
      console.log(`  Flow setup: running journey ${config.setup.journey}`);
      const journeyResult = await runJourney(
        browser,
        config.setup.journey,
        baseUrl,
        viewport,
      );
      storageState = journeyResult.storageState;
    } else if ('steps' in config.setup) {
      console.log(`  Flow setup: running ${config.setup.steps.length} inline steps`);
      const setupContext = await browser.newContext({
        locale: 'zh-CN',
        storageState: storageState || undefined,
      });
      const setupPage = await setupContext.newPage();
      await setupPage.setViewportSize(viewport);
      try {
        await executeSteps(setupPage, config.setup.steps, baseUrl);
        storageState = await setupContext.storageState();
      } finally {
        await setupContext.close();
      }
    }
  }

  // Always create screenshot dir alongside the report
  const screenshotDir = options.outputDir
    ? path.join(options.outputDir, 'screenshots')
    : undefined;
  if (screenshotDir) {
    await fs.mkdir(screenshotDir, { recursive: true });
  }

  // Main flow execution
  const context = await browser.newContext({
    locale: 'zh-CN',
    storageState: storageState || undefined,
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);

  const checkpointResults: FlowCheckpointResult[] = [];
  const visitedUrls: string[] = [];
  const screenshots: ScreenshotInfo[] = [];

  try {
    if (loaded.type === 'yaml') {
      // YAML flow: execute steps one by one
      for (let i = 0; i < config!.steps.length; i++) {
        const step = config!.steps[i];
        const stepType = getStepType(step as JourneyStep);

        try {
          await executeStep(page, step as JourneyStep, baseUrl);
        } catch (err) {
          if (err instanceof FlowStepError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          throw new FlowStepError(i, stepType, message);
        }

        console.log(`  [flow] ${i}: ${stepType}${step.checkpoint ? ' (checkpoint)' : ''}`);

        if (step.checkpoint) {
          const cpResult = await runCheckpoint(
            page, i, step.label || `Step ${i + 1}`, options, screenshotDir, viewport,
          );
          checkpointResults.push(cpResult);

          // Collect screenshot info after issue count is known
          if (cpResult.screenshotPath) {
            screenshots.push({
              pageUrl: cpResult.url,
              viewport,
              state: `flow-${cpResult.label}`,
              path: cpResult.screenshotPath,
            });
          }

          const currentUrl = page.url();
          if (!visitedUrls.includes(currentUrl)) {
            visitedUrls.push(currentUrl);
          }
        }
      }
    } else {
      // JS flow: provide checkpoint function in context
      let stepIndex = 0;
      const checkpointFn = async (label?: string): Promise<FlowCheckpointResult> => {
        const cpLabel = label || `Checkpoint ${stepIndex}`;
        const cpResult = await runCheckpoint(
          page, stepIndex, cpLabel, options, screenshotDir, viewport,
        );
        checkpointResults.push(cpResult);

        if (cpResult.screenshotPath) {
          screenshots.push({
            pageUrl: cpResult.url,
            viewport,
            state: `flow-${cpResult.label}`,
            path: cpResult.screenshotPath,
          });
        }

        stepIndex++;

        const currentUrl = page.url();
        if (!visitedUrls.includes(currentUrl)) {
          visitedUrls.push(currentUrl);
        }

        return cpResult;
      };

      const flowCtx = {
        page,
        resolveUrl: (p: string) => resolveUrl(baseUrl, p),
        baseUrl,
        checkpoint: checkpointFn,
      };

      await loaded.fn(flowCtx);
    }
  } finally {
    storageState = await context.storageState();
    await context.close();
  }

  const durationMs = Date.now() - startTime;
  console.log(`Flow "${flowName}" completed: ${checkpointResults.length} checkpoints, ${(durationMs / 1000).toFixed(1)}s`);

  return {
    name: flowName,
    storageState,
    checkpointResults,
    visitedUrls,
    durationMs,
    screenshots: screenshots.length > 0 ? screenshots : undefined,
  };
}

async function runCheckpoint(
  page: import('playwright').Page,
  stepIndex: number,
  label: string,
  options: FlowRunOptions,
  screenshotDir: string | undefined,
  viewport: ViewportConfig,
): Promise<FlowCheckpointResult> {
  const url = page.url();
  const results: CheckResult[] = [];

  if (!options.noA11y) {
    const a11yResult = await runAccessibilityCheck(page);
    for (const issue of a11yResult.issues) {
      issue.checkpoint = label;
    }
    results.push(a11yResult);
  }

  if (!options.noLayout) {
    const layoutResult = await runLayoutCheck(page);
    for (const issue of layoutResult.issues) {
      issue.checkpoint = label;
    }
    results.push(layoutResult);
  }

  const issueCount = results.reduce((sum, r) => sum + r.issues.length, 0);
  const criticalCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length, 0);
  const warningCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'warning').length, 0);
  console.log(`    [checkpoint] "${label}" at ${url} — ${issueCount} issues (${criticalCount} critical, ${warningCount} warning)`);

  // Always capture screenshot — filename includes checkpoint name and issue summary
  let screenshotPath: string | undefined;
  if (screenshotDir) {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const idx = String(stepIndex + 1).padStart(2, '0');
    const filename = `${idx}-${safeLabel}--${criticalCount}C-${warningCount}W.png`;
    const filePath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
    // Store relative path from the output directory
    screenshotPath = `screenshots/${filename}`;
  }

  return { stepIndex, label, url, results, screenshotPath };
}
