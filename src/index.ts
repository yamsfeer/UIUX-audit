#!/usr/bin/env node

import { Command } from 'commander';
import { runAudit } from './runner.js';
import { createConfig, parseViewports } from './config.js';
import { loadEnv } from './env.js';

loadEnv();

const program = new Command();

program
  .name('uiux-audit')
  .description(
    'Automated UI/UX quality audit tool for websites.\n' +
    'Runs accessibility checks (axe-core), layout checks (overflow, overlap, sizing),\n' +
    'and optional visual review using a vision model.\n\n' +
    'Audit layers:\n' +
    '  1. Accessibility — axe-core rules (labels, landmarks, ARIA, contrast)\n' +
    '  2. Layout — programmatic checks (overflow, overlap, touch targets, viewport)\n' +
    '  3. Visual — screenshots reviewed by a vision model (requires --visual)\n\n' +
    'By default only layers 1 and 2 run (no API cost). Add --visual to enable layer 3.'
  )
  .version('0.1.0')
  .argument('<url>', 'URL of the website to audit (e.g. http://localhost:5173)')
  .option('--visual', 'Enable visual review layer using a vision model (default: off)', false)
  .option('--design-spec <path>', 'Path to a UI/UX design spec (Markdown) for compliance review')
  .option('--model-url <url>', 'Vision model API base URL (or set UIUX_AUDIT_MODEL_URL env)')
  .option('--model-key <key>', 'Vision model API key (or set UIUX_AUDIT_MODEL_KEY env)')
  .option('--model-name <name>', 'Vision model name (default: gpt-4o)', 'gpt-4o')
  .option('--viewport <sizes>', 'Viewport sizes as WxH, comma-separated (default: 1440x900)', '1440x900')
  .option('--output <format>', 'Output format: json, markdown, table (default: table)', 'table')
  .option('--output-file <path>', 'Write report to a file instead of stdout')
  .option('--output-dir <dir>', 'Output directory for reports and screenshots; creates timestamped subdirectory by default')
  .option('--no-timestamp', 'When using --output-dir, write directly to the directory instead of a timestamped subdirectory')
  .option('--no-a11y', 'Skip accessibility checks')
  .option('--no-layout', 'Skip layout checks')
  .option('--pages <urls>', 'Additional page URLs to audit (comma-separated)')
  .option('--journey <path>', 'Path to a journey file (YAML or JS) for login/setup before auditing')
  .addHelpText('after', `
Examples:
  $ uiux-audit http://localhost:5173
    Run accessibility + layout checks (no API cost)

  $ uiux-audit http://localhost:5173 --output json --output-file report.json
    Save full report as JSON for automated processing

  $ uiux-audit http://localhost:5173 --output-dir ./audit-results
    Save report and screenshots to ./audit-results/<timestamp>/

  $ uiux-audit http://localhost:5173 --output-dir ./audit-results --no-timestamp
    Save report and screenshots directly to ./audit-results/

  $ uiux-audit http://localhost:5173 --viewport 1440x900,375x812
    Check at desktop and mobile viewports

  $ uiux-audit http://localhost:5173 --visual \\
      --model-url https://api.openai.com \\
      --model-key sk-xxx
    Enable visual review with a vision model

  $ uiux-audit http://localhost:5173 --visual \\
      --design-spec ./docs/UIUX.md \\
      --model-url https://api.openai.com \\
      --model-key sk-xxx
    Check implementation against a design spec document

  $ uiux-audit http://localhost:5173 --pages /about,/contact
    Audit multiple pages

Environment variables:
  UIUX_AUDIT_MODEL_URL    Vision model API base URL
  UIUX_AUDIT_MODEL_KEY    Vision model API key
  UIUX_AUDIT_MODEL_NAME   Vision model name (default: gpt-4o)

AI Agent workflow:
  1. Start dev server
  2. Run: uiux-audit http://localhost:PORT --output json --output-dir /tmp/audit-results
  3. Read the JSON report from /tmp/audit-results/<timestamp>/report.json
  4. Fix issues by selector and fixSuggestion, then re-run until critical + warning count is zero
`)
  .action(async (url: string, options) => {
    try {
      const viewports = parseViewports(options.viewport);
      const pages = options.pages ? options.pages.split(',').map((s: string) => s.trim()) : undefined;

      const config = createConfig({
        url,
        pages,
        viewports,
        noA11y: options.noA11y ?? false,
        noLayout: options.noLayout ?? false,
        visual: options.visual ?? false,
        designSpec: options.designSpec,
        modelUrl: options.modelUrl,
        modelKey: options.modelKey,
        modelName: options.modelName,
        output: options.output,
        outputFile: options.outputFile,
        outputDir: options.outputDir,
        timestamp: options.timestamp ?? true,
        journey: options.journey,
      });

      await runAudit(config);
    } catch (err) {
      console.error('Audit failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
