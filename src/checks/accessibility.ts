import { Page } from 'playwright';
import { CheckResult, Issue } from './types.js';

const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

interface AxeResult {
  violations: AxeViolation[];
  passes: AxeRuleResult[];
  incomplete: AxeRuleResult[];
}

interface AxeViolation extends AxeRuleResult {
  nodes: AxeNode[];
}

interface AxeRuleResult {
  id: string;
  description: string;
  impact: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

interface AxeNode {
  html: string;
  target: string[];
  failureSummary: string;
}

const IMPACT_MAP: Record<string, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  serious: 'critical',
  moderate: 'warning',
  minor: 'info',
};

const FIX_SUGGESTIONS: Record<string, string> = {
  'label': 'Add a <label> element, aria-label, aria-labelledby, or placeholder attribute to the form element',
  'landmark-one-main': 'Wrap the main page content in a <main> element or add role="main"',
  'region': 'Wrap content sections in landmark elements (<nav>, <main>, <aside>, <footer>) or add role attributes',
  'image-alt': 'Add an alt attribute to the <img> element describing the image content',
  'button-name': 'Add visible text, aria-label, or aria-labelledby to the button',
  'link-name': 'Add visible text, aria-label, or aria-labelledby to the link',
  'heading-order': 'Ensure heading levels follow a logical hierarchy (h1 > h2 > h3, no skipped levels)',
  'color-contrast': 'Increase the foreground/background color contrast ratio to at least 4.5:1 for normal text',
  'list': 'Ensure list items (<li>) are contained within <ul> or <ol> parent elements',
  'listitem': 'Ensure <li> elements are inside a <ul> or <ol> parent element',
  'meta-viewport': 'Avoid using user-scalable=no in the viewport meta tag to allow zooming',
  'html-has-lang': 'Add a lang attribute to the <html> element (e.g. <html lang="en">)',
  'html-lang-valid': 'Use a valid BCP 47 language code for the lang attribute on <html>',
  'document-title': 'Add a <title> element to the <head> of the document',
  'tabindex': 'Avoid using tabindex values greater than 0; use 0 for custom interactive elements',
  'focus-order': 'Ensure focusable elements follow a logical DOM order',
  'focus-visible': 'Add a visible focus indicator (outline or box-shadow) for keyboard focus',
  'aria-allowed-attr': 'Remove ARIA attributes that are not valid for the element\'s role',
  'aria-valid-attr-value': 'Fix ARIA attribute values to match allowed values',
  'aria-valid-attr': 'Remove or correct misspelled ARIA attributes',
  'aria-hidden-focus': 'Do not apply aria-hidden to focusable elements; remove aria-hidden or make the element not focusable',
};

export async function runAccessibilityCheck(page: Page): Promise<CheckResult> {
  const start = Date.now();

  await page.addScriptTag({ url: AXE_CDN });

  const results = await page.evaluate(async () => {
    // @ts-expect-error axe injected at runtime
    return (await window.axe.run()) as AxeResult;
  });

  const issues: Issue[] = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      type: violation.id,
      severity: IMPACT_MAP[violation.impact] || 'warning',
      selector: node.target.join(' > '),
      description: violation.help,
      evidence: node.failureSummary,
      check: 'accessibility' as const,
      fixSuggestion: FIX_SUGGESTIONS[violation.id] || `See ${violation.helpUrl} for fix guidance`,
    }))
  );

  return {
    check: 'accessibility',
    issues,
    duration: Date.now() - start,
  };
}
