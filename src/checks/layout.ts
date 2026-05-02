import { Page } from 'playwright';
import { CheckResult, Issue } from './types.js';

const LAYOUT_CHECK_SCRIPT = `
(() => {
  const issues = [];

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    if (el === document.body) return 'body';
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    const index = siblings.indexOf(el);
    const tag = el.tagName.toLowerCase();
    if (siblings.length === 1) return getSelector(parent) + ' > ' + tag;
    return getSelector(parent) + ' > ' + tag + ':nth-child(' + (index + 1) + ')';
  }

  // 1. Text horizontal overflow
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
        const text = el.textContent?.trim().slice(0, 60) || '';
        if (text) {
          issues.push({
            type: 'overflow-x',
            severity: 'critical',
            selector: getSelector(el),
            description: 'Text overflows container horizontally',
            evidence: 'scrollWidth=' + el.scrollWidth + ' clientWidth=' + el.clientWidth + ' text="' + text + '"',
            fixSuggestion: 'Add overflow-x: auto/scroll, or use text-overflow: ellipsis with overflow: hidden and white-space: nowrap, or increase the container width',
            check: 'layout',
          });
        }
      }
    }
  }

  // 2. Text vertical overflow (clipped)
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && el.clientHeight > 0) {
        const text = el.textContent?.trim().slice(0, 60) || '';
        if (text) {
          issues.push({
            type: 'overflow-y',
            severity: 'critical',
            selector: getSelector(el),
            description: 'Content overflows container vertically and is clipped',
            evidence: 'scrollHeight=' + el.scrollHeight + ' clientHeight=' + el.clientHeight + ' text="' + text + '"',
            fixSuggestion: 'Change overflow-y to auto/scroll, remove the fixed height, or use line-clamp for intentional truncation',
            check: 'layout',
          });
        }
      }
    }
  }

  // 3. Touch targets too small
  const interactiveSelectors = 'a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(interactiveSelectors)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
      issues.push({
        type: 'small-touch-target',
        severity: 'warning',
        selector: getSelector(el),
        description: 'Interactive element is smaller than 44px minimum touch target',
        evidence: 'width=' + Math.round(rect.width) + 'px height=' + Math.round(rect.height) + 'px tag=' + el.tagName,
        fixSuggestion: 'Increase the element size to at least 44x44px, or add padding/min-width/min-height, or use a larger click target area with an invisible hit region',
        check: 'layout',
      });
    }
  }

  // 4. Elements outside viewport
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const style = getComputedStyle(el);
      const isFixedOrAbsolute = style.position === 'fixed' || style.position === 'absolute';
      if (!isFixedOrAbsolute && (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0)) {
        issues.push({
          type: 'outside-viewport',
          severity: 'critical',
          selector: getSelector(el),
          description: 'Element is positioned outside the viewport',
          evidence: 'rect=' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.right) + ',' + Math.round(rect.bottom) + ' viewport=' + window.innerWidth + 'x' + window.innerHeight,
          fixSuggestion: 'Fix the element positioning so it is visible within the viewport; check for negative margins, transforms, or incorrect positioning values',
          check: 'layout',
        });
      }
    }
  }

  // 5. Images missing dimensions
  for (const el of document.querySelectorAll('img')) {
    const hasWidth = el.width > 0 || el.style.width || el.getAttribute('width');
    const hasHeight = el.height > 0 || el.style.height || el.getAttribute('height');
    if (!hasWidth || !hasHeight) {
      issues.push({
        type: 'img-missing-dimensions',
        severity: 'info',
        selector: getSelector(el),
        description: 'Image missing explicit width/height (may cause layout shift)',
        evidence: 'src=' + (el.getAttribute('src') || '').slice(0, 80),
        fixSuggestion: 'Add width and height attributes (or CSS) to the <img> element to prevent Cumulative Layout Shift (CLS)',
        check: 'layout',
      });
    }
  }

  // 6. Zero-size elements with text content (skip single-char symbols like ●○✗)
  for (const el of document.querySelectorAll('*')) {
    const text = el.textContent?.trim();
    if (el.clientWidth === 0 && el.clientHeight === 0 && text && text.length > 2) {
      const style = getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        issues.push({
          type: 'zero-size-with-text',
          severity: 'critical',
          selector: getSelector(el),
          description: 'Element has text content but zero visible dimensions',
          evidence: 'text="' + text.slice(0, 60) + '" display=' + style.display,
          fixSuggestion: 'The element has text but renders at zero size; check for conflicting CSS (e.g. height:0, overflow:hidden on a flex child) or add explicit dimensions',
          check: 'layout',
        });
      }
    }
  }

  // 7. Element overlap (non-parent-child)
  const visibleElements = [];
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      visibleElements.push({ el, rect, selector: getSelector(el) });
    }
  }

  for (let i = 0; i < visibleElements.length; i++) {
    for (let j = i + 1; j < visibleElements.length; j++) {
      const a = visibleElements[i], b = visibleElements[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;

      const ra = a.rect, rb = b.rect;
      if (ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top) {
        const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        const overlapArea = overlapX * overlapY;
        const smallerArea = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (overlapArea > smallerArea * 0.1) {
          const styleA = getComputedStyle(a.el);
          const styleB = getComputedStyle(b.el);
          if ((styleA.position === 'absolute' || styleA.position === 'fixed') ||
              (styleB.position === 'absolute' || styleB.position === 'fixed')) continue;

          issues.push({
            type: 'element-overlap',
            severity: 'warning',
            selector: a.selector,
            description: 'Element overlaps with ' + b.selector,
            evidence: 'overlap=' + Math.round(overlapArea) + 'px² elementA=' + Math.round(ra.width) + 'x' + Math.round(ra.height) + ' elementB=' + Math.round(rb.width) + 'x' + Math.round(rb.height),
            fixSuggestion: 'Adjust margins, padding, or positioning to prevent overlap; consider using flexbox/grid gap for consistent spacing',
          check: 'layout',
          });
          break;
        }
      }
    }
  }

  return issues;
})()
`;

export async function runLayoutCheck(page: Page): Promise<CheckResult> {
  const start = Date.now();

  const issues: Issue[] = await page.evaluate(LAYOUT_CHECK_SCRIPT);

  return {
    check: 'layout',
    issues,
    duration: Date.now() - start,
  };
}
