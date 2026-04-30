import { InteractionCandidate, ExplorationStats, Budget } from './types.js';

export function buildPrioritizationPrompt(
  candidates: InteractionCandidate[],
  budget: Budget,
  visitedUrls: string[],
  sameLayoutCount: number,
): { system: string; user: string } {
  const system = `You are a website exploration agent performing UX audits. Your job is to prioritize which UI interactions are most likely to reveal NEW page layouts or UI states.

Given a list of interactive elements on the current page, rank them by priority. Your goal is to maximize discovery of DIFFERENT page layouts and states, not to revisit similar pages with different data.

## CRITICAL: Distinguish structure from content

### HIGH PRIORITY — Structural navigation (explore ALL of these):
- **Tabs** (role="tab") — Each tab reveals a completely different content panel. Explore EVERY tab.
- **Sidebar / top-nav links** — These lead to entirely different page layouts.
- **Accordion toggles, expand/collapse** — Reveal hidden content areas.
- **Dropdown menus, modals, drawers, dialogs** — Overlays with new interactions.
- **Buttons that clearly toggle page mode** (edit/view, grid/list, filter toggles).

### LOW PRIORITY — Content items (explore at most 1-2):
- **Cards, list items, table rows** that link to detail pages — These almost always share the SAME layout with different data. After exploring 1-2, the rest are redundant.
- **"View more" / pagination links** — Same layout, more items.
- **Repeated action buttons** on each row/card (edit, delete, view) — Same behavior per item.

### Key rule of thumb:
If clicking an element changes the PAGE STRUCTURE (new panels, new sections, different layout), it's HIGH priority.
If clicking an element only changes the DATA shown (different name, different numbers, same layout skeleton), it's LOW priority.

Respond with a JSON array of objects, each with:
- "selector": the CSS selector of the element
- "reason": brief explanation of why this element is prioritized
- "priority": number from 0 to 1 (1 = highest priority)

Include ALL structural navigation elements (tabs, nav links, toggles). For content-list items, include at most 1-2. Omit elements unlikely to reveal new layouts.`;

  const candidateList = candidates.map((c, i) =>
    `${i + 1}. selector: "${c.selector}" | type: ${c.type} | label: "${c.label}" | tag: ${c.tagName}${c.textContent ? ` | text: "${c.textContent}"` : ''}${c.ariaHasPopup ? ` | ariaHasPopup: ${c.ariaHasPopup}` : ''}${c.role ? ` | role: ${c.role}` : ''}`
  ).join('\n');

  const visitedInfo = visitedUrls.length > 0
    ? `\nAlready visited URLs (avoid interactions that lead to these):\n${visitedUrls.map(u => `  - ${u}`).join('\n')}`
    : '';

  const layoutWarning = sameLayoutCount >= 2
    ? `\nWARNING: ${sameLayoutCount} pages with this same layout have already been visited. Prioritize structural elements (tabs, toggles) over content links that likely lead to the same layout again.`
    : '';

  const user = `Interactive elements on the current page:

${candidateList}
${visitedInfo}${layoutWarning}

Budget remaining: ${budget.pagesRemaining} pages, ${budget.statesRemaining} states, ${budget.interactionsRemaining} interactions, ${Math.round(budget.timeRemainingMs / 1000)}s

Rank these elements by priority. Include ALL tabs and structural navigation. Limit content-list items to 1-2. Respond with a JSON array.`;

  return { system, user };
}

export function buildCompletionPrompt(
  description: string,
  stats: ExplorationStats,
): { system: string; user: string } {
  const system = `You are a website exploration agent. Based on the current page and what has been discovered so far, determine if this page likely has more states to explore.

Consider:
- If the page has unexplored navigation items, tabs, or interactive elements, there are likely more states
- If the page is a simple content page with few interactive elements, it may be fully explored
- If statistics show we've already found many states from this page type, diminishing returns suggest moving on

Respond with a JSON object:
- "complete": boolean (true = no more states likely on this page, false = more to explore)
- "reasoning": brief explanation`;

  const user = `Current page: ${description}

Exploration stats so far:
- Pages discovered: ${stats.pagesDiscovered}
- States discovered: ${stats.statesDiscovered}
- Interactions attempted: ${stats.interactionsAttempted}

Is this page fully explored?`;

  return { system, user };
}

export function buildFormStrategyPrompt(
  formSelector: string,
  fields: Array<{ selector: string; type?: string; label?: string; placeholder?: string }>,
): { system: string; user: string } {
  const system = `You are a website exploration agent filling out forms to discover new UI states. Suggest test values for form fields that are likely to successfully submit and reveal new content (success pages, error messages, etc.).

Use realistic but clearly test-oriented values:
- Email fields: test@example.com
- Name fields: Test User
- Phone fields: 555-0100
- Text fields: appropriate short test content
- Select dropdowns: pick the first non-default option
- Checkboxes: check if needed for submission

Respond with a JSON object:
- "fields": array of { "selector", "value", "reason" }`;

  const fieldList = fields.map(f =>
    `- selector: "${f.selector}"${f.type ? ` | type: ${f.type}` : ''}${f.label ? ` | label: "${f.label}"` : ''}${f.placeholder ? ` | placeholder: "${f.placeholder}"` : ''}`
  ).join('\n');

  const user = `Form selector: ${formSelector}

Fields:
${fieldList}

Suggest test values for these fields.`;

  return { system, user };
}
