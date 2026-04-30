import { Page } from 'playwright';
import * as crypto from 'node:crypto';

export async function computeDomHash(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const clone = document.body?.cloneNode(true) as HTMLElement | null;
    if (!clone) return '';

    for (const el of clone.querySelectorAll('script, style, svg, noscript, link')) {
      el.remove();
    }

    for (const el of clone.querySelectorAll('*')) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (
          attr.name === 'data-csrf' ||
          attr.name === 'nonce' ||
          attr.name === 'data-token' ||
          attr.name.includes('timestamp') ||
          attr.name.includes('ts') ||
          attr.name === 'style'
        ) {
          el.removeAttribute(attr.name);
        }
      }
    }

    const innerText = clone.innerText || '';
    return innerText.replace(/\s+/g, ' ').trim();
  });

  return crypto.createHash('sha256').update(text).digest('hex');
}

export function computeStateId(url: string, domHash: string): string {
  const parsed = new URL(url);
  const pathAndQuery = parsed.pathname + parsed.search;
  return `${pathAndQuery}::${domHash.slice(0, 12)}`;
}

export class StateRegistry {
  private visited = new Set<string>();

  has(stateId: string): boolean {
    return this.visited.has(stateId);
  }

  add(stateId: string): void {
    this.visited.add(stateId);
  }

  get size(): number {
    return this.visited.size;
  }
}
