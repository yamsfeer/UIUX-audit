import { Page, BrowserContext } from 'playwright';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export type JourneyStep =
  | { goto: string }
  | { fill: { selector: string; value: string } }
  | { click: string }
  | { press: string }
  | { select: { selector: string; value: string } }
  | { check: string }
  | { uncheck: string }
  | { wait: number }
  | { waitFor: string | { selector: string; timeout?: number } }
  | { waitForNavigation: string }
  | { assert: { selector?: string; url?: string; title?: string } }
  | { screenshot: string };

export interface JourneyConfig {
  name?: string;
  viewport?: { width: number; height: number };
  steps: JourneyStep[];
}

export interface JourneyResult {
  storageState: StorageState;
  auditPages?: string[];
}

export interface JourneyContext {
  page: Page;
  resolveUrl: (path: string) => string;
  baseUrl: string;
}

export type JourneyFn = (ctx: JourneyContext) => Promise<string[] | void>;
