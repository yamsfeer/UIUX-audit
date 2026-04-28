import * as fs from 'node:fs/promises';

export interface DesignSpec {
  content: string;
  path: string;
}

export async function loadDesignSpec(filePath: string): Promise<DesignSpec> {
  const content = await fs.readFile(filePath, 'utf-8');
  return { content, path: filePath };
}
