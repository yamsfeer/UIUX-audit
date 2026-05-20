import yaml from 'js-yaml';
import { FlowConfig, FlowStep } from './types.js';
import { JourneyStep } from '../journey/types.js';
import { validateSteps, interpolateEnvVars, KNOWN_STEP_TYPES } from '../journey/parser.js';

export function parseFlowYaml(content: string): FlowConfig {
  const parsed = yaml.load(content);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Flow file must contain a YAML object with a "steps" array');
  }

  const config = parsed as Record<string, unknown>;

  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new Error('Flow file must contain a "steps" array with at least one step');
  }

  const result: FlowConfig = { steps: [] };

  if (config.name) {
    result.name = String(config.name);
  }

  if (config.viewport && typeof config.viewport === 'string') {
    const match = config.viewport.match(/^(\d+)x(\d+)$/);
    if (!match) {
      throw new Error(`Invalid viewport format in flow: ${config.viewport}. Use WxH (e.g. 1440x900)`);
    }
    result.viewport = { width: parseInt(match[1]), height: parseInt(match[2]) };
  }

  // Parse setup
  if (config.setup) {
    if (typeof config.setup !== 'object' || config.setup === null) {
      throw new Error('Flow setup must be an object');
    }
    const setup = config.setup as Record<string, unknown>;
    const hasJourney = 'journey' in setup && setup.journey !== undefined;
    const hasSteps = 'steps' in setup && setup.steps !== undefined;
    if (hasJourney && hasSteps) {
      throw new Error('Flow setup can contain either "journey" or "steps", not both');
    }
    if (hasJourney) {
      result.setup = { journey: String(setup.journey) };
    } else if (hasSteps) {
      if (!Array.isArray(setup.steps)) {
        throw new Error('Flow setup.steps must be an array');
      }
      const setupSteps = validateSteps(setup.steps);
      result.setup = { steps: setupSteps };
    }
  }

  // Parse steps with checkpoint and label
  const rawSteps = config.steps as unknown[];
  const flowSteps: FlowStep[] = rawSteps.map((step, i) => {
    if (typeof step !== 'object' || step === null) {
      throw new Error(`Flow step ${i} must be an object, got ${typeof step}`);
    }

    const raw = step as Record<string, unknown>;
    const keys = Object.keys(raw);
    const stepType = keys.find((k) => KNOWN_STEP_TYPES.has(k));
    if (!stepType) {
      throw new Error(`Unknown flow step type: '${keys[0]}' at index ${i}. Known types: ${[...KNOWN_STEP_TYPES].join(', ')}`);
    }

    const interpolated = interpolateEnvVars(step, i) as Record<string, unknown>;
    const flowStep: FlowStep = interpolated as unknown as FlowStep;

    if (raw.checkpoint === true) {
      flowStep.checkpoint = true;
    }
    if (raw.label && typeof raw.label === 'string') {
      flowStep.label = raw.label;
    }

    return flowStep;
  });

  // Default checkpoint rule: if no step has checkpoint: true, set it on all
  const hasExplicitCheckpoint = flowSteps.some((s) => s.checkpoint === true);
  if (!hasExplicitCheckpoint) {
    for (const s of flowSteps) {
      s.checkpoint = true;
    }
  }

  // Auto-generate labels for checkpoints without one
  for (let i = 0; i < flowSteps.length; i++) {
    if (flowSteps[i].checkpoint && !flowSteps[i].label) {
      flowSteps[i].label = `Step ${i + 1}`;
    }
  }

  result.steps = flowSteps;
  return result;
}
