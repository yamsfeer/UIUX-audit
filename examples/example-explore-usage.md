# Explore Usage Examples

Explore does not need a config file — it is controlled entirely through CLI flags.
The tool automatically crawls the site, discovers pages and interactive states,
then runs a11y/layout checks on every discovered state.

## How Explore Works

1. Opens the start URL in a headless browser
2. Scans the page for links and interactive elements (buttons, tabs, forms, etc.)
3. Clicks/toggles elements to discover new UI states
4. Deduplicates states by DOM hash (same DOM = same state, skip it)
5. Repeats until budget exhausted (max pages, states, interactions, or timeout)
6. Runs a11y + layout checks on each discovered state
7. Saves exploration screenshots to `<outputDir>/explore-screenshots/`

## Two Modes

### DOM-only mode (--no-explore-ai)

No AI API cost. Uses CSS selectors to find interactive elements and a hardcoded
priority system (nav links > popups > buttons > forms). Good for most sites.

### AI-guided mode (default when --explore is on)

Sends a screenshot + element list to an LLM, asks it to rank which interactions
are most likely to reveal new states. Smarter exploration budget allocation,
but costs API tokens per decision.

## CLI Examples

```bash
# Basic exploration (DOM-only, no AI cost)
uiux-audit http://localhost:5173 \
  --explore --no-explore-ai \
  --output-dir audit-results

# AI-guided exploration
uiux-audit http://localhost:5173 \
  --explore \
  --model-url https://api.openai.com \
  --model-key sk-xxx \
  --explore-model gpt-4o \
  --output-dir audit-results

# Explore with custom limits
uiux-audit http://localhost:5173 \
  --explore \
  --max-pages 20 \
  --max-states 30 \
  --max-interactions 100 \
  --explore-timeout 180000 \
  --output-dir audit-results

# Explore + visual review (sends explored pages to vision model for UX review)
uiux-audit http://localhost:5173 \
  --explore --visual --explore-visual \
  --max-visual-pages 5 \
  --model-url https://api.openai.com \
  --model-key sk-xxx \
  --output-dir audit-results

# Export exploration results
uiux-audit http://localhost:5173 \
  --explore \
  --explore-output explore-map.json \
  --explore-journey explore-journey.yaml \
  --output-dir audit-results
```

## Export Options

- `--explore-output <path>`: Save a JSON site map of all discovered pages/states
- `--explore-journey <path>`: Export as a Journey YAML file (can be reused with `--journey`)

## Visual Review for Explored Pages

By default, explore screenshots are saved but NOT sent to the vision model.
Use `--explore-visual` (requires `--visual`) to opt in. Only one screenshot
per unique URL is sent, capped by `--max-visual-pages` (default: 10).
