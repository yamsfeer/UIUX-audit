import { Browser, Page } from 'playwright';
import { StorageState } from '../journey/types.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  ExplorationConfig,
  ExplorationResult,
  ExplorationStats,
  ExplorationTarget,
  InteractionCandidate,
  PageState,
  Interaction,
  DEFAULT_EXPLORATION_CONFIG,
  Budget,
} from './types.js';
import { extractLinks, extractInteractions, extractPageMetadata } from './dom-extractor.js';
import { computeDomHash, computeLayoutHash, computeStateId, StateRegistry, LayoutRegistry } from './dedup.js';
import { buildSiteMap } from './site-map.js';
import { AIGuide } from './ai-guide.js';

interface ModelConfig {
  modelUrl?: string;
  modelKey?: string;
  modelName: string;
}

export class Explorer {
  private config: ExplorationConfig;
  private browser: Browser;
  private storageState?: StorageState;
  private registry: StateRegistry;
  private aiGuide?: AIGuide;
  private screenshotDir?: string;
  private screenshotIndex = 0;

  constructor(config: ExplorationConfig, browser: Browser, storageState?: StorageState, modelConfig?: ModelConfig, screenshotDir?: string) {
    this.config = config;
    this.browser = browser;
    this.storageState = storageState;
    this.registry = new StateRegistry();
    this.screenshotDir = screenshotDir;

    if (config.aiGuided && modelConfig?.modelUrl && modelConfig?.modelKey) {
      this.aiGuide = new AIGuide(modelConfig);
    }
  }

  async explore(startUrl: string): Promise<ExplorationResult> {
    const startTime = Date.now();
    const stats: ExplorationStats = {
      pagesDiscovered: 0,
      statesDiscovered: 0,
      interactionsAttempted: 0,
      aiDecisionsMade: 0,
      durationMs: 0,
    };

    const results: PageState[] = [];
    const queue: ExplorationTarget[] = [{ type: 'navigate', url: startUrl, depth: 0 }];
    const visitedUrls = new Set<string>();
    const layoutRegistry = new LayoutRegistry(this.config.maxSameLayout);

    while (queue.length > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.config.timeoutMs) break;
      if (stats.statesDiscovered >= this.config.maxStates) break;
      if (stats.pagesDiscovered >= this.config.maxPages) break;

      const target = queue.shift()!;

      const context = await this.browser.newContext({
        locale: 'zh-CN',
        storageState: this.storageState || undefined,
      });
      const page = await context.newPage();

      try {
        // Navigate to the target URL
        await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);

        // If this is an interact target, replay the interaction to reach the new state
        if (target.type === 'interact') {
          stats.interactionsAttempted++;
          await this.executeInteraction(page, target.interaction);
          await page.waitForTimeout(500);
        }

        // Capture state after navigation (and optional interaction)
        const domHash = await computeDomHash(page);
        const layoutHash = await computeLayoutHash(page);
        const currentUrl = page.url();
        const stateId = computeStateId(currentUrl, domHash);

        if (this.registry.has(stateId)) {
          await context.close();
          continue;
        }

        this.registry.add(stateId);
        stats.statesDiscovered++;

        if (!visitedUrls.has(currentUrl)) {
          visitedUrls.add(currentUrl);
          stats.pagesDiscovered++;

          // Track layout and skip if we've seen this layout too many times
          if (target.type === 'navigate' && target.depth > 0) {
            if (layoutRegistry.shouldSkip(layoutHash)) {
              await context.close();
              continue;
            }
          }
          layoutRegistry.record(layoutHash);
        }

        const metadata = await extractPageMetadata(page);
        const pageState = await this.capturePageState(page, stateId, domHash, layoutHash, target, metadata);
        results.push(pageState);

        // AI completion check
        if (this.aiGuide && this.config.aiGuided) {
          const explored = await this.aiGuide.isPageExplored(page, stats);
          if (explored) {
            await context.close();
            continue;
          }
          stats.aiDecisionsMade++;
        }

        // Discover links
        const links = await extractLinks(page, startUrl, this.config);
        for (const link of links) {
          if (link.depth > this.config.maxDepth) continue;
          if (visitedUrls.has(link.url)) continue;

          if (stats.pagesDiscovered + queue.filter(t => t.type === 'navigate').length >= this.config.maxPages) {
            break;
          }

          queue.push({ type: 'navigate', url: link.url, depth: link.depth });
        }

        // Discover interactions
        let candidates = await extractInteractions(page, this.config);

        const budget = this.getBudget(stats, startTime);

        if (this.aiGuide && this.config.aiGuided && candidates.length > 0) {
          const sameLayoutCount = layoutRegistry.getCount(layoutHash);
          const ranked = await this.aiGuide.prioritize(
            page, candidates, stats, budget,
            Array.from(visitedUrls), sameLayoutCount,
          );
          stats.aiDecisionsMade++;
          candidates = ranked
            .map(r => candidates.find(c => c.selector === r.selector))
            .filter((c): c is InteractionCandidate => c !== undefined)
            .slice(0, 8);
        } else {
          candidates.sort((a, b) => b.priority - a.priority);
          candidates = candidates.slice(0, 12);
        }

        for (const candidate of candidates) {
          if (stats.interactionsAttempted >= this.config.maxInteractions) break;

          // Probe the interaction: execute it, check if it produces a new state, then backtrack
          const newStateId = await this.probeInteraction(page, candidate, currentUrl);

          if (newStateId && !this.registry.has(newStateId)) {
            queue.push({
              type: 'interact',
              url: currentUrl,
              interaction: candidate,
              depth: target.depth,
            });
          }
        }
      } catch {
        // Navigation failed, skip this target
      } finally {
        await context.close();
      }
    }

    stats.durationMs = Date.now() - startTime;

    return {
      pageStates: results,
      siteMap: buildSiteMap(results, startUrl),
      stats,
    };
  }

  private async probeInteraction(
    page: Page,
    candidate: InteractionCandidate,
    currentUrl: string,
  ): Promise<string | null> {
    const snapshot = await page.evaluate(() => ({
      url: window.location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }));

    try {
      // Execute the interaction
      await this.executeInteraction(page, candidate);
      await page.waitForTimeout(300);

      const newDomHash = await computeDomHash(page);
      const newStateId = computeStateId(page.url(), newDomHash);
      return newStateId;
    } catch {
      return null;
    } finally {
      // Always restore the original state
      try {
        if (page.url() !== snapshot.url) {
          await page.goBack({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
        }
        if (page.url() !== snapshot.url) {
          await page.goto(snapshot.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        }
        // Press Escape to dismiss any overlays
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
        // Re-navigate if still on wrong page
        if (page.url() !== snapshot.url) {
          await page.goto(snapshot.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        }
      } catch {}
    }
  }

  private getBudget(stats: ExplorationStats, startTime: number): Budget {
    return {
      pagesRemaining: this.config.maxPages - stats.pagesDiscovered,
      statesRemaining: this.config.maxStates - stats.statesDiscovered,
      interactionsRemaining: this.config.maxInteractions - stats.interactionsAttempted,
      timeRemainingMs: this.config.timeoutMs - (Date.now() - startTime),
    };
  }

  private async capturePageState(
    page: Page,
    stateId: string,
    domHash: string,
    layoutHash: string,
    target: ExplorationTarget,
    metadata: { title: string; description: string; h1: string },
  ): Promise<PageState> {
    const description = metadata.h1 || metadata.title || page.url();
    const interactions: Interaction[] = target.type === 'interact'
      ? [{ type: target.interaction.type, selector: target.interaction.selector, label: target.interaction.label, priority: target.interaction.priority }]
      : [];

    let screenshot: string | undefined;
    if (this.screenshotDir) {
      try {
        const safeId = stateId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const filename = `state-${this.screenshotIndex++}-${safeId}.png`;
        const filePath = path.join(this.screenshotDir, filename);
        await page.screenshot({ path: filePath, fullPage: true });
        screenshot = filePath;
      } catch {}
    }

    return {
      url: page.url(),
      stateId,
      description,
      interactions,
      domHash,
      layoutHash,
      screenshot,
    };
  }

  private async executeInteraction(page: Page, interaction: InteractionCandidate): Promise<void> {
    switch (interaction.type) {
      case 'navigate':
        if (interaction.href) {
          await page.goto(interaction.href, { waitUntil: 'networkidle', timeout: 15000 });
        }
        break;
      case 'click':
      case 'toggle-state':
        await page.click(interaction.selector, { timeout: 5000 }).catch(() => {});
        break;
      case 'fill-input':
        if (interaction.value) {
          await page.fill(interaction.selector, interaction.value, { timeout: 5000 }).catch(() => {});
        }
        break;
      case 'submit-form':
        if (this.config.avoidForms) return;
        await page.click(interaction.selector, { timeout: 5000 }).catch(() => {});
        break;
    }
  }
}
