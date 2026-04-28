# uiux-audit

Automated UI/UX quality audit tool for websites. Uses Playwright to load pages, runs programmatic checks (accessibility + layout), and optionally uses a vision model for visual review.

## How It Works

The audit runs in two layers:

**Layer 1: Programmatic checks (no API cost)**
- **Accessibility** — [axe-core](https://github.com/dequelabs/axe-core) checks for labels, landmarks, ARIA, contrast, and more (~90 rules)
- **Layout** — custom DOM checks for text overflow, element overlap, touch target size, viewport issues, and more

**Layer 2: Visual review (requires `--visual`, uses a vision model API)**
- **General review** — detects misalignment, inconsistent spacing, visual hierarchy issues, broken-looking layouts
- **Design compliance** — compares screenshots against a UI/UX design spec document (Markdown) to find deviations

## Installation

```bash
git clone <repo-url> uiux-audit
cd uiux-audit
npm install
npx playwright install chromium
npm run build
```

## Quick Start

```bash
# Run accessibility + layout checks on a local site
node dist/index.js http://localhost:5173

# Save report as JSON
node dist/index.js http://localhost:5173 --output json --output-file report.json

# Save report and screenshots to a directory
node dist/index.js http://localhost:5173 --output json --output-dir ./audit-results

# Enable visual review (requires a vision model API)
node dist/index.js http://localhost:5173 --visual \
  --model-url https://api.openai.com \
  --model-key sk-xxx
```

## Usage

```
uiux-audit <url> [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--visual` | Enable visual review layer using a vision model | off |
| `--design-spec <path>` | UI/UX design spec document (Markdown) for compliance review | — |
| `--model-url <url>` | Vision model API base URL | `UIUX_AUDIT_MODEL_URL` env |
| `--model-key <key>` | Vision model API key | `UIUX_AUDIT_MODEL_KEY` env |
| `--model-name <name>` | Vision model name | `gpt-4o` |
| `--viewport <sizes>` | Viewport sizes as `WxH`, comma-separated | `1440x900` |
| `--output <format>` | Output format: `json`, `markdown`, `table` | `table` |
| `--output-file <path>` | Write report to file instead of stdout | — |
| `--output-dir <dir>` | Output directory for reports and screenshots; creates timestamped subdirectory by default | — |
| `--no-timestamp` | With `--output-dir`, write directly to the directory instead of a timestamped subdirectory | — |
| `--no-a11y` | Skip accessibility checks | — |
| `--no-layout` | Skip layout checks | — |
| `--pages <urls>` | Additional page URLs to audit (comma-separated) | — |

### Environment Variables

| Variable | Description |
|---|---|
| `UIUX_AUDIT_MODEL_URL` | Vision model API base URL |
| `UIUX_AUDIT_MODEL_KEY` | Vision model API key |
| `UIUX_AUDIT_MODEL_NAME` | Vision model name (default: `gpt-4o`) |

### Examples

**Basic audit (no API cost):**
```bash
uiux-audit http://localhost:5173
```

**Save report and screenshots to a directory:**
```bash
# Creates ./audit-results/2026-04-28T15-30-00/report.json and screenshots/
uiux-audit http://localhost:5173 --output json --output-dir ./audit-results

# Write directly to ./audit-results/ (no timestamp subdirectory)
uiux-audit http://localhost:5173 --output json --output-dir ./audit-results --no-timestamp
```

**Multiple viewports (desktop + mobile):**
```bash
uiux-audit http://localhost:5173 --viewport 1440x900,375x812
```

**Full audit with visual review:**
```bash
uiux-audit http://localhost:5173 --visual \
  --model-url https://api.openai.com \
  --model-key sk-xxx \
  --output json --output-file /tmp/ux-report.json
```

**Design compliance check:**
```bash
uiux-audit http://localhost:5173 --visual \
  --design-spec ./docs/UIUX.md \
  --model-url https://api.openai.com \
  --model-key sk-xxx
```

**Audit multiple pages:**
```bash
uiux-audit http://localhost:5173 --pages /about,/contact,/settings
```

## What It Detects

### Accessibility (axe-core)

Labels, landmarks, ARIA attributes, color contrast, heading order, image alt text, focus management, and more (~90 rules from axe-core).

### Layout (programmatic)

| Issue | Severity | Detection |
|---|---|---|
| Text horizontal overflow | critical | `scrollWidth > clientWidth` with `overflow: hidden/clip` |
| Text vertical overflow (clipped) | critical | `scrollHeight > clientHeight` with `overflow-y: hidden/clip` |
| Element overlap | warning | `getBoundingClientRect()` intersection, non-parent-child |
| Touch target too small | warning | Interactive element < 44px in width or height |
| Element outside viewport | critical | Element bounding box outside window dimensions |
| Image missing dimensions | info | `<img>` without explicit width/height |
| Zero-size element with text | critical | `clientWidth=0 && clientHeight=0` with text content |

### Visual (vision model)

Misalignment, inconsistent spacing, visual hierarchy issues, color problems, content cut off, broken-looking layouts, styling inconsistencies, and design spec deviations.

## Output Format

Each issue in the report contains:

| Field | Description |
|---|---|
| `type` | Issue category (e.g. `label`, `overflow-x`, `visual-issue`) |
| `severity` | `critical`, `warning`, or `info` |
| `selector` | CSS selector to locate the problematic element |
| `description` | What the issue is |
| `evidence` | Measurable evidence (dimensions, rule violations, etc.) |
| `fixSuggestion` | How to fix the issue |
| `deviation` | (Design compliance only) Which design rule is violated |

## AI Agent Integration

uiux-audit is designed to work in a loop with AI coding agents:

1. Agent starts the dev server
2. Agent runs: `uiux-audit http://localhost:PORT --output json --output-dir /tmp/audit-results`
3. Agent reads the JSON report from `/tmp/audit-results/<timestamp>/report.json` and fixes issues using `selector` and `fixSuggestion`
4. Agent re-runs the audit
5. Repeat until `critical` and `warning` counts are zero

The JSON output is structured for machine parsing — agents can iterate over `results[].issues[]` and use `selector` to find the source code and `fixSuggestion` to apply fixes.

## Vision Model API

Uses the OpenAI-compatible `/v1/chat/completions` endpoint. Works with any compatible service:

- OpenAI (gpt-4o, gpt-4o-mini)
- Azure OpenAI
- Any service with an OpenAI-compatible API

## License

MIT
