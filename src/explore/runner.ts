import { Browser } from 'playwright';
import { AuditConfig } from '../checks/types.js';
import { StorageState } from '../journey/types.js';
import { ExplorationConfig, ExplorationResult, DEFAULT_EXPLORATION_CONFIG } from './types.js';
import { Explorer } from './explorer.js';
import { formatSiteMap } from './site-map.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function runExplorer(
  config: AuditConfig & { storageState?: StorageState },
  browser: Browser,
  outputDir?: string,
): Promise<ExplorationResult> {
  const exploreConfig: ExplorationConfig = {
    ...DEFAULT_EXPLORATION_CONFIG,
    ...config.exploreConfig,
  };

  if (exploreConfig.aiGuided) {
    if (!config.modelUrl || !config.modelKey) {
      console.log('AI-guided exploration requires model config. Falling back to DOM-only mode.');
      exploreConfig.aiGuided = false;
    }
  }

  const modelName = exploreConfig.exploreModel || config.modelName;

  // Create screenshots directory for exploration
  let screenshotDir: string | undefined;
  if (outputDir) {
    screenshotDir = path.join(outputDir, 'explore-screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
  }

  const explorer = new Explorer(exploreConfig, browser, config.storageState, {
    modelUrl: config.modelUrl,
    modelKey: config.modelKey,
    modelName,
  }, screenshotDir);

  console.log(`Exploring ${config.url}...`);
  if (exploreConfig.aiGuided) {
    console.log('  Mode: AI-guided');
  } else {
    console.log('  Mode: DOM-only (no AI cost)');
  }
  console.log(`  Budget: max ${exploreConfig.maxPages} pages, ${exploreConfig.maxStates} states, ${exploreConfig.maxInteractions} interactions`);

  const result = await explorer.explore(config.url);

  console.log('\n--- Exploration Results ---');
  console.log(`Pages discovered: ${result.stats.pagesDiscovered}`);
  console.log(`States discovered: ${result.stats.statesDiscovered}`);
  console.log(`Interactions attempted: ${result.stats.interactionsAttempted}`);
  if (result.stats.aiDecisionsMade > 0) {
    console.log(`AI decisions made: ${result.stats.aiDecisionsMade}`);
  }
  console.log(`Duration: ${(result.stats.durationMs / 1000).toFixed(1)}s`);

  const screenshotsTaken = result.pageStates.filter(ps => ps.screenshot).length;
  if (screenshotsTaken > 0) {
    console.log(`Screenshots: ${screenshotsTaken} saved to ${screenshotDir}`);
  }

  console.log('\nSite map:');
  console.log(formatSiteMap(result.siteMap));

  return result;
}
