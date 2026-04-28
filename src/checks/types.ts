export type Severity = 'critical' | 'warning' | 'info';

export type CheckSource = 'accessibility' | 'layout' | 'visual';

export interface Issue {
  type: string;
  severity: Severity;
  selector: string;
  description: string;
  evidence: string;
  check: CheckSource;
  fixSuggestion?: string;
  deviation?: string;
}

export interface CheckResult {
  check: CheckSource;
  issues: Issue[];
  duration: number;
}

export interface AuditReport {
  url: string;
  timestamp: string;
  results: CheckResult[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    byCheck: Record<CheckSource, number>;
  };
}

export interface ViewportConfig {
  width: number;
  height: number;
  name: string;
}

export interface ScreenshotInfo {
  pageUrl: string;
  viewport: ViewportConfig;
  state: string;
  path: string;
}

export interface AuditConfig {
  url: string;
  pages?: string[];
  viewports: ViewportConfig[];
  noA11y: boolean;
  noLayout: boolean;
  visual: boolean;
  designSpec?: string;
  modelUrl?: string;
  modelKey?: string;
  modelName: string;
  output: 'json' | 'markdown' | 'table';
  outputFile?: string;
  outputDir?: string;
  timestamp: boolean;
}
