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

/**
 * Hash based on DOM structure (tags, classes, roles) WITHOUT text content.
 * Pages with the same layout but different data produce the same layout hash.
 */
export async function computeLayoutHash(page: Page): Promise<string> {
  const structure = await page.evaluate(() => {
    function getSignature(el: Element, depth: number): string {
      if (depth > 5) return '';
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).sort().join('.');
      const role = el.getAttribute('role') || '';
      const ariaExpanded = el.getAttribute('aria-expanded') || '';
      const ariaHasPopup = el.getAttribute('aria-haspopup') || '';

      let sig = tag;
      if (classes) sig += '.' + classes;
      if (role) sig += '[role=' + role + ']';
      if (ariaExpanded) sig += '[aria-expanded]';
      if (ariaHasPopup) sig += '[aria-haspopup]';

      const children: string[] = [];
      for (let i = 0; i < el.children.length; i++) {
        children.push(getSignature(el.children[i], depth + 1));
      }

      if (children.length > 0) {
        sig += '(' + children.join(',') + ')';
      }

      return sig;
    }

    return getSignature(document.body, 0);
  });

  return crypto.createHash('sha256').update(structure).digest('hex').slice(0, 16);
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

/**
 * Tracks how many pages of each layout we've visited.
 * Caps same-layout visits to avoid wasting budget on identical page structures.
 */
export class LayoutRegistry {
  private counts = new Map<string, number>();
  private maxSameLayout: number;

  constructor(maxSameLayout = 2) {
    this.maxSameLayout = maxSameLayout;
  }

  /** Returns true if this layout has been seen too many times already. */
  shouldSkip(layoutHash: string): boolean {
    const count = this.counts.get(layoutHash) || 0;
    return count >= this.maxSameLayout;
  }

  /** Record a visit to a layout. Returns the new count. */
  record(layoutHash: string): number {
    const count = (this.counts.get(layoutHash) || 0) + 1;
    this.counts.set(layoutHash, count);
    return count;
  }

  getCount(layoutHash: string): number {
    return this.counts.get(layoutHash) || 0;
  }
}
