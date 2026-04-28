import yaml from 'js-yaml';
import { JourneyConfig, JourneyStep } from './types.js';

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function interpolateEnvVars(value: unknown, stepIndex: number): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_RE, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(`Journey uses ${match} but ${varName} is not set in environment or .env (found at step ${stepIndex})`);
      }
      return envValue;
    });
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnvVars(v, stepIndex));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolateEnvVars(v, stepIndex);
    }
    return result;
  }
  return value;
}

const KNOWN_STEP_TYPES = new Set([
  'goto', 'fill', 'click', 'press', 'select',
  'check', 'uncheck', 'wait', 'waitFor',
  'waitForNavigation', 'assert', 'screenshot',
]);

function validateSteps(raw: unknown[]): JourneyStep[] {
  return raw.map((step, i) => {
    if (typeof step !== 'object' || step === null) {
      throw new Error(`Journey step ${i} must be an object, got ${typeof step}`);
    }

    const keys = Object.keys(step as Record<string, unknown>);
    const stepType = keys.find((k) => KNOWN_STEP_TYPES.has(k));
    if (!stepType) {
      throw new Error(`Unknown journey step type: '${keys[0]}' at index ${i}. Known types: ${[...KNOWN_STEP_TYPES].join(', ')}`);
    }

    const interpolated = interpolateEnvVars(step, i);
    return interpolated as JourneyStep;
  });
}

export function parseYaml(content: string): JourneyConfig {
  const parsed = yaml.load(content);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Journey file must contain a YAML object with a "steps" array');
  }

  const config = parsed as Record<string, unknown>;

  if (!Array.isArray(config.steps)) {
    throw new Error('Journey file must contain a "steps" array');
  }

  const steps = validateSteps(config.steps);

  const result: JourneyConfig = { steps };

  if (config.name) {
    result.name = String(config.name);
  }

  if (config.viewport && typeof config.viewport === 'string') {
    const match = config.viewport.match(/^(\d+)x(\d+)$/);
    if (!match) {
      throw new Error(`Invalid viewport format in journey: ${config.viewport}. Use WxH (e.g. 1440x900)`);
    }
    result.viewport = { width: parseInt(match[1]), height: parseInt(match[2]) };
  }

  return result;
}
