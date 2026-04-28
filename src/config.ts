import { AuditConfig, ViewportConfig } from './checks/types.js';

const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { width: 1440, height: 900, name: 'desktop' },
];

export function createConfig(options: Partial<AuditConfig> & { url: string }): AuditConfig {
  return {
    url: options.url,
    pages: options.pages,
    viewports: options.viewports || DEFAULT_VIEWPORTS,
    noA11y: options.noA11y ?? false,
    noLayout: options.noLayout ?? false,
    visual: options.visual ?? false,
    designSpec: options.designSpec,
    modelUrl: options.modelUrl || process.env.UIUX_AUDIT_MODEL_URL,
    modelKey: options.modelKey || process.env.UIUX_AUDIT_MODEL_KEY,
    modelName: options.modelName || process.env.UIUX_AUDIT_MODEL_NAME || 'gpt-4o',
    output: options.output || 'table',
    outputFile: options.outputFile,
    outputDir: options.outputDir,
    timestamp: options.timestamp ?? true,
    journey: options.journey,
  };
}

export function parseViewports(input: string): ViewportConfig[] {
  return input.split(',').map((spec, i) => {
    const match = spec.trim().match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error(`Invalid viewport format: ${spec}. Use WxH (e.g. 1440x900)`);
    return { width: parseInt(match[1]), height: parseInt(match[2]), name: `viewport-${i}` };
  });
}

export function resolveUrl(base: string, target: string): string {
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target;
  }
  const origin = new URL(base).origin;
  return origin + (target.startsWith('/') ? target : '/' + target);
}
