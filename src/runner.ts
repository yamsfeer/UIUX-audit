import { chromium, Browser } from 'playwright';
import { AuditConfig, CheckResult } from './checks/types.js';
import { StorageState } from './journey/types.js';
import { runAccessibilityCheck } from './checks/accessibility.js';
import { runLayoutCheck } from './checks/layout.js';
import { captureScreenshots, cleanupScreenshots, ScreenshotTarget } from './visual/screenshot.js';
import { runVisualReview } from './visual/reviewer.js';
import { loadDesignSpec } from './visual/design-spec.js';
import { buildReport, formatJson, formatMarkdown, formatTable } from './report/formatter.js';
import { runJourney } from './journey/runner.js';
import { runExplorer } from './explore/runner.js';
import { exportSiteMapJson, generateJourneyYaml } from './explore/site-map.js';
import { ExplorationResult, Interaction } from './explore/types.js';
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

async function replayInteractions(page: import('playwright').Page, interactions: Interaction[]): Promise<void> {
  for (const interaction of interactions) {
    try {
      switch (interaction.type) {
        case 'navigate':
          await page.goto(interaction.selector, { waitUntil: 'networkidle', timeout: 15000 });
          break;
        case 'click':
        case 'toggle-state':
          await page.click(interaction.selector, { timeout: 5000 });
          break;
        case 'fill-input':
          if (interaction.value) {
            await page.fill(interaction.selector, interaction.value, { timeout: 5000 });
          }
          break;
        case 'submit-form':
          await page.click(interaction.selector, { timeout: 5000 });
          break;
      }
      await page.waitForTimeout(300);
    } catch {
      // Skip failed interactions
    }
  }
}

export async function runAudit(config: AuditConfig): Promise<void> {
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const results: CheckResult[] = [];
    let storageState: StorageState | undefined;
    let auditPages = config.pages;
    let explorationResult: ExplorationResult | undefined;

    // Run journey if provided
    if (config.journey) {
      try {
        const journeyResult = await runJourney(
          browser,
          config.journey,
          config.url,
          config.viewports[0],
        );
        storageState = journeyResult.storageState;
        if (journeyResult.auditPages) {
          const existing = new Set(auditPages ?? []);
          const merged = [...(auditPages ?? [])];
          for (const p of journeyResult.auditPages) {
            if (!existing.has(p)) {
              merged.push(p);
            }
          }
          auditPages = merged;
        }
      } catch (err) {
        console.error(`Journey failed: ${err instanceof Error ? err.message : err}`);
        console.error('Cannot proceed with audit — session state is invalid.');
        process.exit(1);
      }
    }

    // Resolve output directory early so explorer and report share the same timestamped subdir
    const outDir = await resolveOutputDir(config);
    let savedScreenshotDir: string | undefined;

    // Run explorer if enabled
    if (config.explore) {
      try {
        explorationResult = await runExplorer({
          ...config,
          storageState,
        }, browser, outDir);

        // Merge discovered pages into audit scope
        const discoveredUrls = explorationResult.pageStates.map(ps => ps.url);
        const existing = new Set(auditPages ?? []);
        const merged = [...(auditPages ?? [])];
        for (const p of discoveredUrls) {
          if (!existing.has(p)) {
            merged.push(p);
          }
        }
        auditPages = merged;

        // Save exploration map if requested
        if (config.exploreOutput) {
          await fs.writeFile(
            config.exploreOutput,
            JSON.stringify(exportSiteMapJson(explorationResult), null, 2),
            'utf-8',
          );
          console.log(`Exploration map saved to ${config.exploreOutput}`);
        }

        // Save journey YAML if requested
        if (config.exploreJourney) {
          const yaml = generateJourneyYaml(explorationResult);
          await fs.writeFile(config.exploreJourney, yaml, 'utf-8');
          console.log(`Journey file saved to ${config.exploreJourney}`);
        }
      } catch (err) {
        console.error(`Exploration failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Programmatic checks on main URL
    const context = await browser.newContext({ locale: 'zh-CN', storageState: storageState || undefined });
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

    // Run checks on discovered page states
    if (explorationResult && explorationResult.pageStates.length > 1) {
      const stateIssues: Record<string, number> = {};
      console.log(`Running checks on ${explorationResult.pageStates.length - 1} discovered states...`);

      for (const ps of explorationResult.pageStates) {
        if (ps.url === config.url && ps.interactions.length === 0) continue;

        const stateContext = await browser.newContext({
          locale: 'zh-CN',
          storageState: storageState || undefined,
        });
        const statePage = await stateContext.newPage();
        await statePage.setViewportSize({ width: config.viewports[0].width, height: config.viewports[0].height });

        try {
          await statePage.goto(ps.url, { waitUntil: 'networkidle', timeout: 30000 });
          await replayInteractions(statePage, ps.interactions);

          const stateResults: CheckResult[] = [];
          if (!config.noA11y) {
            stateResults.push(await runAccessibilityCheck(statePage));
          }
          if (!config.noLayout) {
            stateResults.push(await runLayoutCheck(statePage));
          }

          const issueCount = stateResults.reduce((sum, r) => sum + r.issues.length, 0);
          if (issueCount > 0) {
            stateIssues[ps.stateId] = issueCount;
            results.push(...stateResults);
          }
        } catch {
          // Skip states that fail to load
        } finally {
          await stateContext.close();
        }
      }

      // Store state issue counts for report
      if (explorationResult) {
        (explorationResult as ExplorationResult & { stateIssues?: Record<string, number> }).stateIssues = stateIssues;
      }
    }

    // Visual review
    if (config.visual) {
      const screenshotDir = outDir ? path.join(outDir, 'screenshots') : undefined;
      if (!config.modelUrl || !config.modelKey) {
        console.error('Error: UIUX_AUDIT_MODEL_KEY environment variable is required when --visual is enabled.');
        console.error('Set it in your shell or .env file. Never pass API keys on the command line.');
        process.exit(1);
      }

      console.log('Capturing screenshots...');

      // Build screenshot targets from exploration (deduplicated by URL, capped)
      let exploreTargets: ScreenshotTarget[] | undefined;
      if (config.exploreVisual && explorationResult) {
        const seenUrls = new Set<string>();
        const maxPages = config.maxVisualPages ?? 10;
        exploreTargets = [];
        for (const ps of explorationResult.pageStates) {
          if (seenUrls.has(ps.url)) continue;
          seenUrls.add(ps.url);
          exploreTargets.push({ url: ps.url, label: ps.stateId, interactions: ps.interactions });
          if (exploreTargets.length >= maxPages) break;
        }
        if (exploreTargets.length > 0) {
          console.log(`Sending ${exploreTargets.length} explored pages to visual review`);
        }
      }

      const { screenshots, tempDir, persistent } = await captureScreenshots(
        browser,
        config.url,
        config.viewports,
        config.pages,
        screenshotDir,
        storageState,
        exploreTargets,
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
    const explorationMeta = explorationResult ? {
      pagesDiscovered: explorationResult.stats.pagesDiscovered,
      statesDiscovered: explorationResult.stats.statesDiscovered,
      interactionsAttempted: explorationResult.stats.interactionsAttempted,
      aiDecisionsMade: explorationResult.stats.aiDecisionsMade,
      durationMs: explorationResult.stats.durationMs,
      stateIssues: (explorationResult as ExplorationResult & { stateIssues?: Record<string, number> }).stateIssues || {},
      screenshots: explorationResult.pageStates
        .filter(ps => ps.screenshot)
        .map(ps => ({ stateId: ps.stateId, description: ps.description, path: ps.screenshot! })),
    } : undefined;

    const report = buildReport(config.url, results, explorationMeta);

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
