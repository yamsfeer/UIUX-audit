import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FlowConfig, FlowFn, LoadedFlow } from './types.js';
import { parseFlowYaml } from './parser.js';

export async function loadFlow(filePath: string): Promise<LoadedFlow> {
  const ext = path.extname(filePath).toLowerCase();
  const resolved = path.resolve(filePath);

  if (ext === '.yaml' || ext === '.yml') {
    const content = await fs.readFile(resolved, 'utf-8');
    const config = parseFlowYaml(content);
    return { type: 'yaml', config };
  }

  if (ext === '.js') {
    const mod = await import(resolved);
    const fn = mod.default ?? mod;
    if (typeof fn !== 'function') {
      throw new Error('Flow script must export a default async function');
    }
    return { type: 'js', fn };
  }

  if (ext === '.ts') {
    throw new Error(
      'TypeScript flow files are not supported directly. Compile with `tsc` first, then point --flow to the .js output.',
    );
  }

  throw new Error(`Unsupported flow file extension: ${ext}. Use .yaml, .yml, or .js`);
}
