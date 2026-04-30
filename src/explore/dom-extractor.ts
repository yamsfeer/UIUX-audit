import { Page } from 'playwright';
import { LinkCandidate, InteractionCandidate, PageMetadata, ExplorationConfig } from './types.js';

export async function extractLinks(page: Page, baseUrl: string, config: ExplorationConfig): Promise<LinkCandidate[]> {
  const base = new URL(baseUrl);

  const raw: Array<{ href: string; selector: string; text: string }> = await page.evaluate(() => {
    const links: Array<{ href: string; selector: string; text: string }> = [];
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((a, i) => {
      const el = a as HTMLAnchorElement;
      const href = el.href;
      if (!href) return;
      if (href.startsWith('javascript:')) return;
      if (href === 'javascript:void(0)') return;
      if (href.startsWith('mailto:')) return;
      if (href.startsWith('tel:')) return;

      let selector = `a[href="${CSS.escape(el.getAttribute('href') || '')}"]`;
      if (document.querySelectorAll(selector).length > 1) {
        selector = `a:nth-of-type(${i + 1})`;
        const parent = el.parentElement;
        if (parent) {
          const parentSelector = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
          selector = `${parentSelector} > ${selector}`;
        }
      }

      links.push({
        href,
        selector,
        text: (el.textContent || '').trim().slice(0, 100),
      });
    });
    return links;
  });

  const seen = new Set<string>();
  const results: LinkCandidate[] = [];

  for (const link of raw) {
    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(link.href, baseUrl).href;
    } catch {
      continue;
    }

    const parsed = new URL(resolvedUrl);
    if (parsed.hash && parsed.pathname === base.pathname && parsed.search === base.search) {
      continue;
    }

    const cleanUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    if (cleanUrl === `${base.origin}${base.pathname}${base.search}`) continue;

    if (config.stayOnOrigin && !isSameOrigin(resolvedUrl, baseUrl)) {
      continue;
    }

    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    const depth = parsed.pathname.split('/').filter(Boolean).length;

    results.push({
      url: cleanUrl,
      selector: link.selector,
      text: link.text,
      depth,
    });
  }

  return results;
}

export async function extractInteractions(page: Page, config: ExplorationConfig): Promise<InteractionCandidate[]> {
  const raw = await page.evaluate(() => {
    const candidates: Array<{
      selector: string;
      tagName: string;
      textContent: string;
      href?: string;
      role?: string;
      ariaHasPopup?: string;
      type: string;
      label: string;
      ariaLabel?: string;
      title?: string;
      placeholder?: string;
      inputType?: string;
      inNav: boolean;
    }> = [];

    const selectors = [
      'button',
      '[role="button"]',
      'input[type="submit"]',
      'input[type="button"]',
      '[aria-haspopup]',
      '[data-modal]',
      '[data-dropdown]',
      '[data-overlay]',
      '[role="tab"]',
      'details > summary',
      '[aria-expanded]',
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
      'select',
      'textarea',
      '[onclick]',
      '[tabindex]:not([tabindex="-1"])',
    ];

    const seen = new Set<Element>();

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      elements.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const htmlEl = el as HTMLElement;
        const tagName = htmlEl.tagName.toLowerCase();
        const textContent = (htmlEl.textContent || '').trim().slice(0, 100);

        let selector = '';
        if (htmlEl.id) {
          selector = `#${CSS.escape(htmlEl.id)}`;
        } else {
          const tag = tagName;
          const classes = htmlEl.className && typeof htmlEl.className === 'string'
            ? '.' + htmlEl.className.trim().split(/\s+/).map(c => CSS.escape(c)).join('.')
            : '';
          selector = tag + classes;
          if (document.querySelectorAll(selector).length > 1) {
            const parent = htmlEl.parentElement;
            if (parent) {
              const parentSel = parent.id ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
              selector = `${parentSel} > ${selector}`;
            }
          }
        }

        const role = htmlEl.getAttribute('role') || undefined;
        const ariaHasPopup = htmlEl.getAttribute('aria-haspopup') || undefined;
        const ariaLabel = htmlEl.getAttribute('aria-label') || undefined;
        const title = htmlEl.getAttribute('title') || undefined;
        const placeholder = (htmlEl as HTMLInputElement).getAttribute('placeholder') || undefined;

        let interactionType = 'click';
        if (tagName === 'a' || role === 'link') interactionType = 'navigate';
        else if (ariaHasPopup || htmlEl.hasAttribute('data-modal') || htmlEl.hasAttribute('data-dropdown') || htmlEl.hasAttribute('data-overlay')) interactionType = 'toggle-state';
        else if (role === 'tab' || htmlEl.hasAttribute('aria-expanded') || (tagName === 'summary')) interactionType = 'toggle-state';
        else if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') interactionType = 'fill-input';
        else if (htmlEl.getAttribute('type') === 'submit') {
          interactionType = 'submit-form';
        }

        const label = ariaLabel || title || placeholder || textContent || selector;

        const inNav = !!htmlEl.closest('nav, [role="navigation"]');

        candidates.push({
          selector,
          tagName,
          textContent,
          href: (htmlEl as HTMLAnchorElement).href || undefined,
          role,
          ariaHasPopup,
          type: interactionType,
          label,
          ariaLabel,
          title,
          placeholder,
          inputType: (htmlEl as HTMLInputElement).type || undefined,
          inNav,
        });
      });
    }

    return candidates;
  });

  const results: InteractionCandidate[] = [];

  for (const item of raw) {
    const visible = await page.isVisible(item.selector).catch(() => false);
    if (!visible) continue;

    if (config.avoidDestructive) {
      const text = (item.textContent + ' ' + item.label + ' ' + item.title + ' ' + item.ariaLabel).toLowerCase();
      if (/\b(delete|remove|destroy|logout|sign\s?out)\b/i.test(text) || /退出|删除|移除/.test(text)) continue;
    }

    if (config.avoidForms && (item.type === 'submit-form' || item.type === 'fill-input')) {
      continue;
    }

    let priority = 0.5;
    if (item.inNav) priority = 0.9;
    else if (item.ariaHasPopup || item.type === 'toggle-state') priority = 0.7;
    else if (item.type === 'navigate') priority = 0.8;
    else if (item.type === 'submit-form') priority = 0.3;
    else if (item.type === 'fill-input') priority = 0.3;

    results.push({
      type: item.type as InteractionCandidate['type'],
      selector: item.selector,
      label: item.label,
      priority,
      tagName: item.tagName,
      textContent: item.textContent,
      href: item.href,
      role: item.role,
      ariaHasPopup: item.ariaHasPopup,
    });
  }

  return results;
}

export async function extractPageMetadata(page: Page): Promise<PageMetadata> {
  return page.evaluate(() => {
    const title = document.title || '';
    const description = (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content || '';
    const h1 = (document.querySelector('h1')?.textContent || '').trim();
    const visibleTextLength = (document.body?.innerText || '').length;
    const interactionCount = document.querySelectorAll(
      'button, [role="button"], a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ).length;

    return { title, description, h1, visibleTextLength, interactionCount };
  });
}

export function isSameOrigin(url1: string, url2: string): boolean {
  try {
    const a = new URL(url1);
    const b = new URL(url2);
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
  } catch {
    return false;
  }
}
