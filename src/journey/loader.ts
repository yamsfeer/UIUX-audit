import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { JourneyConfig, JourneyFn } from './types.js';
import { parseYaml } from './parser.js';

export type LoadedJourney =
  | { type: 'yaml'; config: JourneyConfig }
  | { type: 'js'; fn: JourneyFn };

export async function loadJourney(filePath: string): Promise<LoadedJourney> {
  const ext = path.extname(filePath).toLowerCase();
  const resolved = path.resolve(filePath);

  if (ext === '.yaml' || ext === '.yml') {
    const content = await fs.readFile(resolved, 'utf-8');
    const config = parseYaml(content);
    return { type: 'yaml', config };
  }

  if (ext === '.js') {
    const mod = await import(resolved);
    const fn = mod.default ?? mod;
    if (typeof fn !== 'function') {
      throw new Error('Journey script must export a default async function');
    }
    return { type: 'js', fn };
  }

  if (ext === '.ts') {
    throw new Error(
      'TypeScript journey files are not supported directly. Compile with `tsc` first, then point --journey to the .js output.'
    );
  }

  throw new Error(`Unsupported journey file extension: ${ext}. Use .yaml, .yml, or .js`);
}
