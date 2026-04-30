import { Page } from 'playwright';
import {
  InteractionCandidate,
  ExplorationStats,
  Budget,
  RankedInteraction,
  FormFillPlan,
} from './types.js';
import {
  buildPrioritizationPrompt,
  buildCompletionPrompt,
  buildFormStrategyPrompt,
} from './prompts.js';

interface AIGuideConfig {
  modelUrl?: string;
  modelKey?: string;
  modelName: string;
}

export class AIGuide {
  private config: AIGuideConfig;

  constructor(config: AIGuideConfig) {
    this.config = config;
  }

  async prioritize(
    page: Page,
    candidates: InteractionCandidate[],
    history: ExplorationStats,
    budget: Budget,
  ): Promise<RankedInteraction[]> {
    try {
      const { system, user } = buildPrioritizationPrompt(candidates, budget);

      const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
      const base64 = screenshot.toString('base64');

      const data = await this.callModel(system, [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: 'text', text: user },
      ]);

      const parsed = JSON.parse(extractJson(data)) as RankedInteraction[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Fallback: sort by DOM heuristic priority
      return candidates
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5)
        .map(c => ({ selector: c.selector, reason: 'DOM heuristic fallback', priority: c.priority }));
    }
  }

  async isPageExplored(page: Page, history: ExplorationStats): Promise<boolean> {
    try {
      const description = await page.evaluate(() => document.title || window.location.pathname);

      const { system, user } = buildCompletionPrompt(description, history);

      const data = await this.callModel(system, [{ type: 'text', text: user }]);
      const parsed = JSON.parse(extractJson(data)) as { complete: boolean; reasoning: string };
      return parsed.complete === true;
    } catch {
      return false;
    }
  }

  async suggestFormFill(
    page: Page,
    formSelector: string,
  ): Promise<FormFillPlan> {
    try {
      const fields = await page.evaluate((sel) => {
        const form = document.querySelector(sel);
        if (!form) return [];

        const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
        return Array.from(inputs).map((el) => {
          const html = el as HTMLInputElement;
          return {
            selector: html.id ? `#${html.id}` : `${html.tagName.toLowerCase()}[name="${html.name || ''}"]`,
            type: html.type || undefined,
            label: html.getAttribute('aria-label') || html.getAttribute('title') || undefined,
            placeholder: html.getAttribute('placeholder') || undefined,
          };
        });
      }, formSelector);

      if (fields.length === 0) return { fields: [] };

      const { system, user } = buildFormStrategyPrompt(formSelector, fields);

      const data = await this.callModel(system, [{ type: 'text', text: user }]);
      const parsed = JSON.parse(extractJson(data)) as FormFillPlan;
      return parsed;
    } catch {
      return { fields: [] };
    }
  }

  private async callModel(
    systemPrompt: string,
    userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>,
  ): Promise<string> {
    if (!this.config.modelUrl || !this.config.modelKey) {
      throw new Error('Model config not available');
    }

    const baseUrl = this.config.modelUrl.replace(/\/$/, '');
    let apiUrl: string;
    if (baseUrl.endsWith('/chat/completions')) {
      apiUrl = baseUrl;
    } else if (/\/v\d+$/.test(baseUrl)) {
      apiUrl = `${baseUrl}/chat/completions`;
    } else {
      apiUrl = `${baseUrl}/v1/chat/completions`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.modelKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Model API error (${response.status})`);
    }

    const result = await response.json() as { choices: Array<{ message: { content: string } }> };
    return result.choices[0]?.message?.content || '';
  }
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  return text;
}
