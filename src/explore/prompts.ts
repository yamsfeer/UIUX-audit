import { InteractionCandidate, ExplorationStats, Budget } from './types.js';

export function buildPrioritizationPrompt(
  candidates: InteractionCandidate[],
  budget: Budget,
): { system: string; user: string } {
  const system = `You are a website exploration agent performing UX audits. Your job is to prioritize which UI interactions are most likely to reveal new page states or content.

Given a list of interactive elements on the current page, rank them by how likely they are to reveal new UI states (new pages, modals, dropdowns, panels, tabs, etc.).

Consider:
- Elements that trigger navigation to new pages are high value
- Elements that open overlays, modals, or panels reveal hidden states
- Tab/accordion toggles show alternative content views
- Form submissions may lead to confirmation or error states
- Repeated similar elements (e.g., list items) likely lead to similar states

Respond with a JSON array of objects, each with:
- "selector": the CSS selector of the element
- "reason": brief explanation of why this element is prioritized
- "priority": number from 0 to 1 (1 = highest priority)

Only include elements you think are worth trying. Omit elements that seem unlikely to reveal new content.`;

  const candidateList = candidates.map((c, i) =>
    `${i + 1}. selector: "${c.selector}" | type: ${c.type} | label: "${c.label}" | tag: ${c.tagName}${c.textContent ? ` | text: "${c.textContent}"` : ''}${c.ariaHasPopup ? ` | ariaHasPopup: ${c.ariaHasPopup}` : ''}${c.role ? ` | role: ${c.role}` : ''}`
  ).join('\n');

  const user = `Interactive elements on the current page:

${candidateList}

Budget remaining: ${budget.pagesRemaining} pages, ${budget.statesRemaining} states, ${budget.interactionsRemaining} interactions, ${Math.round(budget.timeRemainingMs / 1000)}s

Rank these elements by priority. Respond with a JSON array.`;

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
