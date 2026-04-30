import { SiteMapNode, ExplorationResult, PageState, Interaction } from './types.js';

export function buildSiteMap(pageStates: PageState[], startUrl: string): SiteMapNode {
  const root: SiteMapNode = {
    path: '/',
    label: 'Home',
    url: startUrl,
    children: [],
    states: [],
  };

  for (const ps of pageStates) {
    let parsed: URL;
    try {
      parsed = new URL(ps.url);
    } catch {
      continue;
    }

    const path = parsed.pathname || '/';
    if (path === '/') {
      if (ps.interactions.length > 0) {
        const stateLabel = ps.interactions.map(i => i.label).join(', ');
        if (!root.states.includes(stateLabel)) {
          root.states.push(stateLabel);
        }
      }
      continue;
    }

    const segments = path.split('/').filter(Boolean);

    let current = root;

    for (const segment of segments) {
      let child = current.children.find(c => c.path === segment);
      if (!child) {
        child = {
          path: segment,
          label: segment,
          url: ps.url,
          children: [],
          states: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    if (ps.interactions.length > 0) {
      const stateLabel = ps.interactions.map(i => i.label).join(', ');
      if (!current.states.includes(stateLabel)) {
        current.states.push(stateLabel);
      }
    }
  }

  return root;
}

export function formatSiteMap(node: SiteMapNode, indent = 0): string {
  const prefix = '  '.repeat(indent);
  let line = `${prefix}/${node.path}`;
  if (indent === 0) {
    line = `  / (${node.label})`;
  } else {
    line = `${prefix}├── /${node.path}`;
  }

  const lines: string[] = [line];

  for (const state of node.states) {
    lines.push(`${prefix}│   [state: ${state}]`);
  }

  for (const child of node.children) {
    lines.push(formatSiteMap(child, indent + 1));
  }

  return lines.join('\n');
}

export function exportSiteMapJson(result: ExplorationResult): object {
  return {
    stats: result.stats,
    pageStates: result.pageStates.map(ps => ({
      url: ps.url,
      stateId: ps.stateId,
      description: ps.description,
      interactions: ps.interactions,
      domHash: ps.domHash,
    })),
    siteMap: serializeSiteMapNode(result.siteMap),
  };
}

function serializeSiteMapNode(node: SiteMapNode): object {
  return {
    path: node.path,
    label: node.label,
    url: node.url,
    states: node.states,
    children: node.children.map(serializeSiteMapNode),
  };
}

export function generateJourneyYaml(result: ExplorationResult): string {
  const steps: string[] = [];
  steps.push('name: Auto-explored journey');
  steps.push('steps:');

  let lastUrl = '';

  for (const ps of result.pageStates) {
    const url = new URL(ps.url);
    const path = url.pathname + url.search;

    if (ps.url !== lastUrl) {
      steps.push(`  - goto: ${path}`);
      lastUrl = ps.url;
    }

    for (const interaction of ps.interactions) {
      switch (interaction.type) {
        case 'click':
        case 'toggle-state':
          steps.push(`  - click: ${interaction.selector}`);
          steps.push(`  - wait: 300`);
          break;
        case 'fill-input':
          if (interaction.value) {
            steps.push(`  - fill: { selector: ${interaction.selector}, value: ${interaction.value} }`);
          }
          break;
        case 'submit-form':
          steps.push(`  - click: ${interaction.selector}`);
          steps.push(`  - waitFor: body`);
          break;
      }
    }
  }

  return steps.join('\n') + '\n';
}
