import { ScreenshotInfo, Issue } from '../checks/types.js';
import { DesignSpec } from './design-spec.js';
import * as fs from 'node:fs/promises';

interface VisualReviewOptions {
  modelUrl: string;
  modelKey: string;
  modelName: string;
  designSpec?: DesignSpec;
}

interface VisualIssue {
  selector: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  fixSuggestion?: string;
  deviation?: string;
}

export async function runVisualReview(
  screenshots: ScreenshotInfo[],
  options: VisualReviewOptions
): Promise<Issue[]> {
  const allIssues: Issue[] = [];

  // Process screenshots in batches of 2 to avoid token limits
  const batchSize = 2;
  for (let i = 0; i < screenshots.length; i += batchSize) {
    const batch = screenshots.slice(i, i + batchSize);
    const issues = await reviewBatch(batch, options);
    allIssues.push(...issues);
  }

  return allIssues;
}

async function reviewBatch(
  screenshots: ScreenshotInfo[],
  options: VisualReviewOptions
): Promise<Issue[]> {
  const images: Array<{ type: string; media_type: string; data: string }> = [];

  for (const shot of screenshots) {
    const buffer = await fs.readFile(shot.path);
    const base64 = buffer.toString('base64');
    images.push({
      type: 'image_url',
      media_type: 'image/png',
      data: base64,
    });
  }

  const systemPrompt = options.designSpec
    ? buildDesignCompliancePrompt(options.designSpec.content)
    : buildGeneralReviewPrompt();

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  for (let i = 0; i < screenshots.length; i++) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${images[i].data}` },
    });
  }
  userContent.push({
    type: 'text',
    text: `Review these screenshots for UI/UX issues. Page: ${screenshots[0].pageUrl}, Viewport: ${screenshots[0].viewport.name} (${screenshots[0].viewport.width}x${screenshots[0].viewport.height}), State: ${screenshots.map(s => s.state).join(', ')}`,
  });

  const baseUrl = options.modelUrl.replace(/\/$/, '');
  let apiUrl: string;
  if (baseUrl.endsWith('/chat/completions')) {
    apiUrl = baseUrl;
  } else if (/\/v\d+$/.test(baseUrl)) {
    apiUrl = `${baseUrl}/chat/completions`;
  } else {
    apiUrl = `${baseUrl}/v1/chat/completions`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.modelKey}`,
    },
    body: JSON.stringify({
      model: options.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Visual model API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content || '[]';

  try {
    const issues: VisualIssue[] = JSON.parse(extractJson(content));
    return issues.map((issue) => ({
      type: 'visual-issue',
      severity: issue.severity || 'warning',
      selector: issue.selector || '',
      description: issue.description,
      evidence: `viewport=${screenshots[0].viewport.name} state=${screenshots[0].state}`,
      check: 'visual' as const,
      fixSuggestion: issue.fixSuggestion,
      deviation: issue.deviation,
    }));
  } catch {
    return [{
      type: 'visual-review-parse-error',
      severity: 'warning',
      selector: '',
      description: 'Failed to parse visual model response',
      evidence: content.slice(0, 200),
      check: 'visual',
    }];
  }
}

function extractJson(text: string): string {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find JSON array directly
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  return text;
}

function buildGeneralReviewPrompt(): string {
  return `You are a UI/UX quality reviewer. Analyze the provided screenshots and identify visual/UX issues.

Focus on:
- Text truncation or clipping that makes content unreadable
- Misaligned elements (labels, buttons, text blocks)
- Inconsistent spacing between similar elements
- Color contrast issues
- Visual hierarchy problems (heading sizes, font weights)
- Content that appears cut off or hidden
- Layout that looks broken or messy
- Elements that appear too close together or overlapping
- Inconsistent styling of similar components
- Missing visual feedback for interactive elements

Output a JSON array of issues. Each issue must have:
- "selector": CSS selector or descriptive path to the element (e.g. "header > nav", ".card-title")
- "description": What the issue is
- "fixSuggestion": How to fix it (specific CSS or HTML change)
- "severity": "critical" (broken/unusable), "warning" (looks bad but works), or "info" (minor polish)

If no issues found, output an empty array: []`;
}

function buildDesignCompliancePrompt(designSpec: string): string {
  return `You are a UI/UX quality reviewer. You have been provided with a design specification document and screenshots of an implementation.

Your job is to check whether the implementation matches the design specification.

Design specification:
---
${designSpec}
---

CRITICAL RULE: Every fixSuggestion you provide MUST reference the exact value from the design specification. Do NOT suggest generic fixes. Instead, suggest changes that bring the implementation back in line with the design spec.

For example:
- BAD:  fixSuggestion: "Change the button color to something more visible"
- GOOD: fixSuggestion: "Change button background to bg-blue-600 (#2563EB) as specified in Design Spec Section 3.1"

For each issue found, output a JSON object in an array with:
- "selector": CSS selector or descriptive path to the element
- "description": What the issue is and how it deviates from the design spec
- "fixSuggestion": How to fix it — must reference the specific design spec value (exact color, spacing, font size, component style, etc.)
- "severity": "critical" (fundamental deviation), "warning" (noticeable difference), or "info" (minor difference)
- "deviation": Which specific design rule or section is being violated (reference the design spec)

Also check for general UX issues (text overflow, misalignment, broken layout) even if not explicitly covered by the design spec. For these, use your best judgment for fixSuggestion since no design spec value exists.

Output a JSON array. If no issues found, output: []`;
}
