import { Page } from 'playwright';
import { JourneyStep, JourneyConfig } from './types.js';
import { resolveUrl } from '../config.js';

export class JourneyStepError extends Error {
  constructor(
    public readonly stepIndex: number,
    public readonly stepType: string,
    message: string,
  ) {
    super(`Journey failed at step ${stepIndex} (${stepType}): ${message}`);
    this.name = 'JourneyStepError';
  }
}

export async function executeSteps(
  page: Page,
  steps: JourneyStep[],
  baseUrl: string,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepType = getStepType(step);

    try {
      await executeStep(page, step, baseUrl);
      logStep(i, step, stepType);
    } catch (err) {
      if (err instanceof JourneyStepError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new JourneyStepError(i, stepType, message);
    }
  }
}

function getStepType(step: JourneyStep): string {
  if ('goto' in step) return 'goto';
  if ('fill' in step) return 'fill';
  if ('click' in step) return 'click';
  if ('press' in step) return 'press';
  if ('select' in step) return 'select';
  if ('check' in step) return 'check';
  if ('uncheck' in step) return 'uncheck';
  if ('wait' in step) return 'wait';
  if ('waitFor' in step) return 'waitFor';
  if ('waitForNavigation' in step) return 'waitForNavigation';
  if ('assert' in step) return 'assert';
  if ('screenshot' in step) return 'screenshot';
  return 'unknown';
}

function logStep(index: number, step: JourneyStep, stepType: string): void {
  if ('goto' in step) {
    console.log(`  [journey] ${index}: goto ${step.goto}`);
  } else if ('fill' in step) {
    console.log(`  [journey] ${index}: fill ${step.fill.selector}`);
  } else if ('click' in step) {
    console.log(`  [journey] ${index}: click ${step.click}`);
  } else if ('press' in step) {
    console.log(`  [journey] ${index}: press ${step.press}`);
  } else if ('select' in step) {
    console.log(`  [journey] ${index}: select ${step.select.selector}`);
  } else if ('waitFor' in step) {
    const sel = typeof step.waitFor === 'string' ? step.waitFor : step.waitFor.selector;
    console.log(`  [journey] ${index}: waitFor ${sel}`);
  } else {
    console.log(`  [journey] ${index}: ${stepType}`);
  }
}

async function executeStep(
  page: Page,
  step: JourneyStep,
  baseUrl: string,
): Promise<void> {
  if ('goto' in step) {
    const url = resolveUrl(baseUrl, step.goto);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return;
  }

  if ('fill' in step) {
    await page.fill(step.fill.selector, step.fill.value, { timeout: 10000 });
    return;
  }

  if ('click' in step) {
    await page.click(step.click, { timeout: 10000 });
    return;
  }

  if ('press' in step) {
    await page.keyboard.press(step.press);
    return;
  }

  if ('select' in step) {
    await page.selectOption(step.select.selector, step.select.value, { timeout: 10000 });
    return;
  }

  if ('check' in step) {
    await page.check(step.check, { timeout: 10000 });
    return;
  }

  if ('uncheck' in step) {
    await page.uncheck(step.uncheck, { timeout: 10000 });
    return;
  }

  if ('wait' in step) {
    await page.waitForTimeout(step.wait);
    return;
  }

  if ('waitFor' in step) {
    if (typeof step.waitFor === 'string') {
      await page.waitForSelector(step.waitFor, { timeout: 10000 });
    } else {
      await page.waitForSelector(step.waitFor.selector, {
        timeout: step.waitFor.timeout ?? 10000,
      });
    }
    return;
  }

  if ('waitForNavigation' in step) {
    await page.waitForURL(step.waitForNavigation || '**', { timeout: 30000 });
    return;
  }

  if ('assert' in step) {
    const { selector, url, title } = step.assert;
    if (selector) {
      const el = await page.$(selector);
      if (!el) {
        throw new JourneyStepError(
          -1, 'assert',
          `expected selector "${selector}" to be visible`,
        );
      }
    }
    if (url) {
      const currentUrl = page.url();
      if (!currentUrl.includes(url)) {
        throw new JourneyStepError(
          -1, 'assert',
          `expected URL to contain "${url}", got "${currentUrl}"`,
        );
      }
    }
    if (title) {
      const currentTitle = await page.title();
      if (!currentTitle.includes(title)) {
        throw new JourneyStepError(
          -1, 'assert',
          `expected title to contain "${title}", got "${currentTitle}"`,
        );
      }
    }
    return;
  }

  if ('screenshot' in step) {
    if (step.screenshot) {
      await page.screenshot({ path: step.screenshot });
    }
    return;
  }
}
