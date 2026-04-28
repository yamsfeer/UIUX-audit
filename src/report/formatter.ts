import { AuditReport, CheckResult, Issue, Severity } from '../checks/types.js';

export function buildReport(url: string, results: CheckResult[]): AuditReport {
  const allIssues = results.flatMap((r) => r.issues);
  return {
    url,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: allIssues.length,
      critical: allIssues.filter((i) => i.severity === 'critical').length,
      warning: allIssues.filter((i) => i.severity === 'warning').length,
      info: allIssues.filter((i) => i.severity === 'info').length,
      byCheck: {
        accessibility: allIssues.filter((i) => i.check === 'accessibility').length,
        layout: allIssues.filter((i) => i.check === 'layout').length,
        visual: allIssues.filter((i) => i.check === 'visual').length,
      },
    },
  };
}

export function formatJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatMarkdown(report: AuditReport): string {
  const lines: string[] = [
    `# UX Audit Report`,
    ``,
    `- **URL**: ${report.url}`,
    `- **Time**: ${report.timestamp}`,
    `- **Total Issues**: ${report.summary.total}`,
    `  - Critical: ${report.summary.critical}`,
    `  - Warning: ${report.summary.warning}`,
    `  - Info: ${report.summary.info}`,
    ``,
  ];

  for (const result of report.results) {
    if (result.issues.length === 0) continue;
    lines.push(`## ${result.check} (${result.issues.length} issues, ${result.duration}ms)`);
    lines.push('');

    const sorted = [...result.issues].sort(bySeverity);
    for (const issue of sorted) {
      const badge = severityBadge(issue.severity);
      lines.push(`### ${badge} ${issue.type}`);
      lines.push(`- **Selector**: \`${issue.selector}\``);
      lines.push(`- **Description**: ${issue.description}`);
      lines.push(`- **Evidence**: ${issue.evidence}`);
      if (issue.fixSuggestion) {
        lines.push(`- **Fix**: ${issue.fixSuggestion}`);
      }
      if (issue.deviation) {
        lines.push(`- **Design Deviation**: ${issue.deviation}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function formatTable(report: AuditReport): string {
  const allIssues = report.results.flatMap((r) => r.issues);
  if (allIssues.length === 0) {
    return 'No issues found.';
  }

  const sorted = [...allIssues].sort(bySeverity);
  const lines: string[] = [
    `UX Audit: ${report.url}`,
    `Found ${report.summary.total} issues (critical: ${report.summary.critical}, warning: ${report.summary.warning}, info: ${report.summary.info})`,
    '',
  ];

  // Column widths
  const sevW = 9;
  const checkW = 13;
  const typeW = 22;
  const descW = 50;

  lines.push(
    pad('SEVERITY', sevW) + ' ' +
    pad('CHECK', checkW) + ' ' +
    pad('TYPE', typeW) + ' ' +
    pad('DESCRIPTION', descW)
  );
  lines.push('-'.repeat(sevW + checkW + typeW + descW + 3));

  for (const issue of sorted) {
    lines.push(
      pad(issue.severity, sevW) + ' ' +
      pad(issue.check, checkW) + ' ' +
      pad(issue.type, typeW) + ' ' +
      pad(truncate(issue.description, descW), descW)
    );
  }

  lines.push('');
  if (report.results.some(r => r.issues.length > 0)) {
    lines.push('Run with --output json or --output markdown for detailed evidence and selectors.');
  }

  return lines.join('\n');
}

function bySeverity(a: Issue, b: Issue): number {
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return order[a.severity] - order[b.severity];
}

function severityBadge(severity: Severity): string {
  const map: Record<Severity, string> = { critical: '[CRITICAL]', warning: '[WARNING]', info: '[INFO]' };
  return map[severity];
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len - 1) + '…' : s.padEnd(len);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
