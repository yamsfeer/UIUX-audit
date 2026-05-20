import { chromium, Browser } from 'playwright';
import { AuditConfig, CheckResult } from './checks/types.js';
import { StorageState } from './journey/types.js';
import { runAccessibilityCheck } from './checks/accessibility.js';
import { runLayoutCheck } from './checks/layout.js';
import { captureScreenshots, cleanupScreenshots, ScreenshotTarget, replayInteractions } from './visual/screenshot.js';
import { runVisualReview } from './visual/reviewer.js';
import { loadDesignSpec } from './visual/design-spec.js';
import { buildReport, formatJson, formatMarkdown, formatTable } from './report/formatter.js';
import { runJourney } from './journey/runner.js';
import { runExplorer } from './explore/runner.js';
import { exportSiteMapJson, generateJourneyYaml } from './explore/site-map.js';
import { ExplorationResult } from './explore/types.js';
import { runFlow } from './flow/runner.js';
import { FlowResult } from './flow/types.js';
import { gotoPage } from './navigate.js';
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
    let storageState: StorageState | undefined;
    let auditPages = config.pages;
    let explorationResult: ExplorationResult | undefined;
    let flowResult: FlowResult | undefined;

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
        if (browser) await browser.close();
        process.exit(1);
      }
    }

    // Resolve output directory early so flow, explorer and report share the same timestamped subdir
    const outDir = await resolveOutputDir(config);
    let savedScreenshotDir: string | undefined;

    // Run flow if provided
    if (config.flow) {
      try {
        flowResult = await runFlow(browser, config.flow, config.url, {
          storageState,
          viewports: config.viewports,
          noA11y: config.noA11y,
          noLayout: config.noLayout,
          visual: config.visual,
          modelUrl: config.modelUrl,
          modelKey: config.modelKey,
          modelName: config.modelName,
          outputDir: outDir,
        });

        // Use flow's storageState for subsequent operations
        storageState = flowResult.storageState;

        // Push checkpoint results into main results
        for (const cp of flowResult.checkpointResults) {
          results.push(...cp.results);
        }

        // Merge flow-visited URLs into audit pages
        const existing = new Set(auditPages ?? []);
        const merged = [...(auditPages ?? [])];
        for (const p of flowResult.visitedUrls) {
          if (!existing.has(p)) {
            merged.push(p);
          }
        }
        auditPages = merged;
      } catch (err) {
        console.error(`Flow failed: ${err instanceof Error ? err.message : err}`);
        if (browser) await browser.close();
        process.exit(1);
      }
    }

    // Run explorer if enabled
    if (config.explore) {
      try {
        explorationResult = await runExplorer({
          ...config,
          storageState,
        }, browser, outDir, flowResult?.visitedUrls);

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

    // Programmatic checks on main URL (skip if flow already covered it)
    if (!flowResult) {
      const context = await browser.newContext({ locale: 'zh-CN', storageState: storageState || undefined });
      const page = await context.newPage();
      await page.setViewportSize({ width: config.viewports[0].width, height: config.viewports[0].height });
      await gotoPage(page, config.url);

      if (!config.noA11y) {
        console.log('Running accessibility check...');
        results.push(await runAccessibilityCheck(page));
      }

      if (!config.noLayout) {
        console.log('Running layout check...');
        results.push(await runLayoutCheck(page));
      }

      // Always capture a screenshot of the main page
      if (outDir) {
        const mainScreenshotDir = path.join(outDir, 'screenshots');
        await fs.mkdir(mainScreenshotDir, { recursive: true });
        const mainIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
        const mainCritical = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length, 0);
        const mainWarning = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'warning').length, 0);
        const mainFile = path.join(mainScreenshotDir, `00-home--${mainCritical}C-${mainWarning}W.png`);
        await page.screenshot({ path: mainFile, fullPage: true }).catch(() => {});
        console.log(`Screenshot: screenshots/00-home--${mainCritical}C-${mainWarning}W.png`);
        savedScreenshotDir = mainScreenshotDir;
      }

      await context.close();
    }

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
          await gotoPage(statePage, ps.url);
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
        if (browser) await browser.close();
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

      // Build screenshot targets from flow checkpoints
      let flowTargets: ScreenshotTarget[] | undefined;
      if (flowResult && flowResult.checkpointResults.length > 0) {
        flowTargets = flowResult.checkpointResults.map(cp => ({
          url: cp.url,
          label: `flow-${cp.label}`,
        }));
        if (flowTargets.length > 0) {
          console.log(`Sending ${flowTargets.length} flow checkpoints to visual review`);
        }
      }

      const allTargets: ScreenshotTarget[] = [
        ...(exploreTargets ?? []),
        ...(flowTargets ?? []),
      ];

      const { screenshots, tempDir, persistent } = await captureScreenshots(
        browser,
        config.url,
        config.viewports,
        auditPages,
        screenshotDir,
        storageState,
        allTargets.length > 0 ? allTargets : undefined,
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

    const flowMeta = flowResult ? {
      name: flowResult.name,
      checkpoints: flowResult.checkpointResults.map(cp => ({
        stepIndex: cp.stepIndex,
        label: cp.label,
        url: cp.url,
        issueCount: cp.results.reduce((sum, r) => sum + r.issues.length, 0),
        screenshot: cp.screenshotPath,
      })),
      totalDurationMs: flowResult.durationMs,
    } : undefined;

    const report = buildReport(config.url, results, explorationMeta, flowMeta);

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
