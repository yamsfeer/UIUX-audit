export interface Interaction {
  type: 'navigate' | 'click' | 'toggle-state' | 'submit-form' | 'fill-input';
  selector: string;
  value?: string;
  label: string;
  priority: number;
}

export interface InteractionCandidate extends Interaction {
  tagName: string;
  textContent: string;
  href?: string;
  role?: string;
  ariaHasPopup?: string;
}

export interface LinkCandidate {
  url: string;
  selector: string;
  text: string;
  depth: number;
}

export interface PageMetadata {
  title: string;
  description: string;
  h1: string;
  visibleTextLength: number;
  interactionCount: number;
}

export interface PageState {
  url: string;
  stateId: string;
  description: string;
  interactions: Interaction[];
  domHash: string;
  screenshot?: string;
}

export interface ExplorationConfig {
  maxPages: number;
  maxStates: number;
  maxDepth: number;
  maxInteractions: number;
  timeoutMs: number;
  stayOnOrigin: boolean;
  avoidDestructive: boolean;
  avoidForms: boolean;
  aiGuided: boolean;
  exploreModel?: string;
}

export const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  maxPages: 30,
  maxStates: 50,
  maxDepth: 5,
  maxInteractions: 200,
  timeoutMs: 300_000,
  stayOnOrigin: true,
  avoidDestructive: true,
  avoidForms: false,
  aiGuided: true,
  exploreModel: undefined,
};

export interface ExplorationResult {
  pageStates: PageState[];
  siteMap: SiteMapNode;
  stats: ExplorationStats;
}

export interface ExplorationStats {
  pagesDiscovered: number;
  statesDiscovered: number;
  interactionsAttempted: number;
  aiDecisionsMade: number;
  durationMs: number;
}

export interface ExplorationContext {
  visited: Set<string>;
  queue: ExplorationTarget[];
  config: ExplorationConfig;
  stats: ExplorationStats;
}

export type ExplorationTarget =
  | { type: 'navigate'; url: string; depth: number }
  | { type: 'interact'; url: string; interaction: InteractionCandidate; depth: number };

export interface SiteMapNode {
  path: string;
  label: string;
  url: string;
  children: SiteMapNode[];
  states: string[];
}

export interface PageSnapshot {
  url: string;
  scrollX: number;
  scrollY: number;
}

export interface RankedInteraction {
  selector: string;
  reason: string;
  priority: number;
}

export interface FormFillPlan {
  fields: Array<{ selector: string; value: string; reason: string }>;
}

export interface Budget {
  pagesRemaining: number;
  statesRemaining: number;
  interactionsRemaining: number;
  timeRemainingMs: number;
}
