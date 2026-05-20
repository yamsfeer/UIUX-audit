import { Page } from 'playwright';
import { JourneyStep, StorageState, JourneyContext } from '../journey/types.js';
import { CheckResult, ScreenshotInfo } from '../checks/types.js';

export type FlowStep = JourneyStep & {
  checkpoint?: boolean;
  label?: string;
};

export type FlowSetup =
  | { journey: string }
  | { steps: JourneyStep[] };

export interface FlowConfig {
  name?: string;
  viewport?: { width: number; height: number };
  setup?: FlowSetup;
  steps: FlowStep[];
}

export interface FlowCheckpointResult {
  stepIndex: number;
  label: string;
  url: string;
  results: CheckResult[];
  screenshotPath?: string;
}

export interface FlowResult {
  name: string;
  storageState: StorageState;
  checkpointResults: FlowCheckpointResult[];
  visitedUrls: string[];
  durationMs: number;
  screenshots?: ScreenshotInfo[];
}

export interface FlowContext extends JourneyContext {
  checkpoint: (label?: string) => Promise<FlowCheckpointResult>;
}

export type FlowFn = (ctx: FlowContext) => Promise<void>;

export type LoadedFlow =
  | { type: 'yaml'; config: FlowConfig }
  | { type: 'js'; fn: FlowFn };

export class FlowStepError extends Error {
  constructor(
    public readonly stepIndex: number,
    public readonly stepType: string,
    message: string,
  ) {
    super(`Flow failed at step ${stepIndex} (${stepType}): ${message}`);
    this.name = 'FlowStepError';
  }
}
