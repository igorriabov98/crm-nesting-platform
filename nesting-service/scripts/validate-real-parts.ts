import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseStepFile, type ContourSource, type ParsedPart, type StepParseResult } from '../src/lib/step-parser';

type SourceBucket = 'brepFlat' | 'brepUnfolded' | 'EXACT_BOUNDARY' | 'CONVEX_HULL' | 'RECT_ESTIMATE';

type PartRow = {
  name: string;
  source: ContourSource | 'PARSE_ERROR';
  thickness: number | null;
  width: number | null;
  height: number | null;
  bendCount: number | null;
};

type FallbackReasonRow = {
  partName: string;
  reason: string;
};

type FileReport = {
  file: string;
  bodies: number;
  parseTimeMs: number;
  parts: PartRow[];
  fallbackReasons: FallbackReasonRow[];
  warnings: string[];
  errors: string[];
};

const SOURCE_BUCKETS: SourceBucket[] = ['brepFlat', 'brepUnfolded', 'EXACT_BOUNDARY', 'CONVEX_HULL', 'RECT_ESTIMATE'];
const PARSE_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const targetDir = process.argv[2];

  if (!targetDir) {
    throw new Error('Usage: npm run validate:real -- <folder>');
  }

  const rootDir = path.resolve(targetDir);
  const files = await findStepFiles(rootDir);
  const fileReports: FileReport[] = [];

  for (const file of files) {
    const startedAt = Date.now();

    try {
      const result = await withTimeout(parseStepFile(file), PARSE_TIMEOUT_MS, `timeout after ${PARSE_TIMEOUT_MS}ms`);
      fileReports.push(toFileReport(rootDir, file, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fileReports.push({
        file: path.relative(rootDir, file),
        bodies: 0,
        parseTimeMs: Date.now() - startedAt,
        parts: [],
        fallbackReasons: [{ partName: path.basename(file), reason: message }],
        warnings: isWarningLine(message) ? [message] : [],
        errors: [message],
      });
    }
  }

  const summary = buildSummary(fileReports);
  const jsonPath = path.resolve(process.cwd(), 'validation-report.json');
  const markdownPath = path.resolve(process.cwd(), 'validation-report.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, renderMarkdown(summary), 'utf8');

  console.log(`[validate-real] files=${summary.totalFiles} bodies=${summary.totalBodies}`);
  console.log(`[validate-real] markdown=${markdownPath}`);
  console.log(`[validate-real] json=${jsonPath}`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

async function findStepFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findStepFiles(fullPath)));
    } else if (entry.isFile() && /\.(step|stp)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function toFileReport(rootDir: string, file: string, result: StepParseResult): FileReport {
  const warnings = collectWarnings(result);

  return {
    file: path.relative(rootDir, file),
    bodies: result.parts.length,
    parseTimeMs: result.parseTimeMs,
    parts: result.parts.map((part) => toPartRow(part)),
    fallbackReasons: result.brepTrace
      .filter((trace) => trace.reason)
      .map((trace) => ({ partName: trace.partName, reason: trace.reason ?? 'unknown fallback reason' })),
    warnings,
    errors: result.success ? result.errors : [...result.errors, 'parse failed'],
  };
}

function toPartRow(part: ParsedPart): PartRow {
  return {
    name: part.name,
    source: part.contourSource,
    thickness: round(part.thickness),
    width: round(part.width),
    height: round(part.height),
    bendCount: part.bendCount,
  };
}

function collectWarnings(result: StepParseResult): string[] {
  const warnings = new Set<string>();

  for (const error of result.errors) {
    if (isWarningLine(error)) {
      warnings.add(error);
    }
  }

  for (const part of result.parts) {
    if (part.classificationWarning) {
      warnings.add(`${part.name}: ${part.classificationWarning}`);
    }

    if (part.kFactorDefaulted) {
      warnings.add(`${part.name}: kFactorDefaulted`);
    }
  }

  for (const trace of result.brepTrace) {
    if (trace.reason && isWarningLine(trace.reason)) {
      warnings.add(`${trace.partName}: ${trace.reason}`);
    }
  }

  return [...warnings].sort();
}

function isWarningLine(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('area') ||
    normalized.includes('bend-zone') ||
    normalized.includes('вырез') ||
    normalized.includes('k-factor') ||
    normalized.includes('kfactor') ||
    normalized.includes('timeout')
  );
}

function buildSummary(fileReports: FileReport[]) {
  const totalBodies = fileReports.reduce((sum, file) => sum + file.bodies, 0);
  const sourceCounts = Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, 0])) as Record<SourceBucket, number>;
  const fallbackReasons = new Map<string, number>();
  const warningRows: Array<{ file: string; warning: string }> = [];

  for (const file of fileReports) {
    for (const part of file.parts) {
      const bucket = toSourceBucket(part.source);

      if (bucket) {
        sourceCounts[bucket] += 1;
      }
    }

    for (const item of file.fallbackReasons) {
      increment(fallbackReasons, item.reason);
    }

    for (const warning of file.warnings) {
      warningRows.push({ file: file.file, warning });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: fileReports.length,
    totalBodies,
    sourceCounts: SOURCE_BUCKETS.map((source) => ({
      source,
      count: sourceCounts[source],
      percent: totalBodies === 0 ? 0 : roundPercent((sourceCounts[source] / totalBodies) * 100),
    })),
    topFallbackReasons: [...fallbackReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
      .slice(0, 10),
    files: fileReports,
    warnings: warningRows,
  };
}

function toSourceBucket(source: PartRow['source']): SourceBucket | null {
  if (source === 'EXACT_BREP') {
    return 'brepFlat';
  }

  if (source === 'UNFOLDED_BREP') {
    return 'brepUnfolded';
  }

  if (source === 'EXACT_BOUNDARY' || source === 'CONVEX_HULL' || source === 'RECT_ESTIMATE') {
    return source;
  }

  return null;
}

function renderMarkdown(summary: ReturnType<typeof buildSummary>): string {
  const lines: string[] = [];

  lines.push('# Real STEP Validation Report');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(`Total files: ${summary.totalFiles}`);
  lines.push(`Total bodies: ${summary.totalBodies}`);
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  lines.push('| Source | Count | Percent |');
  lines.push('| --- | ---: | ---: |');

  for (const item of summary.sourceCounts) {
    lines.push(`| ${item.source} | ${item.count} | ${item.percent}% |`);
  }

  lines.push('');
  lines.push('## Top Fallback Reasons');
  lines.push('');

  if (summary.topFallbackReasons.length === 0) {
    lines.push('No fallback reasons.');
  } else {
    lines.push('| Reason | Count |');
    lines.push('| --- | ---: |');

    for (const item of summary.topFallbackReasons) {
      lines.push(`| ${escapeCell(item.reason)} | ${item.count} |`);
    }
  }

  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('| File | Bodies | Sources | Thickness | Dimensions | Bend count | Parse ms |');
  lines.push('| --- | ---: | --- | --- | --- | --- | ---: |');

  for (const file of summary.files) {
    const sources = escapeCell(file.parts.map((part) => part.source).join(', ') || '-');
    const thicknesses = escapeCell(file.parts.map((part) => formatNumber(part.thickness)).join(', ') || '-');
    const dimensions = escapeCell(file.parts.map((part) => formatDimensions(part)).join(', ') || '-');
    const bendCounts = escapeCell(file.parts.map((part) => formatNumber(part.bendCount)).join(', ') || '-');

    lines.push(`| ${escapeCell(file.file)} | ${file.bodies} | ${sources} | ${thicknesses} | ${dimensions} | ${bendCounts} | ${file.parseTimeMs} |`);
  }

  lines.push('');
  lines.push('## Warnings');
  lines.push('');

  if (summary.warnings.length === 0) {
    lines.push('No warnings.');
  } else {
    lines.push('| File | Warning |');
    lines.push('| --- | --- |');

    for (const item of summary.warnings) {
      lines.push(`| ${escapeCell(item.file)} | ${escapeCell(item.warning)} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatDimensions(part: PartRow): string {
  if (part.width === null || part.height === null) {
    return '-';
  }

  return `${formatNumber(part.width)}x${formatNumber(part.height)}`;
}

function formatNumber(value: number | null): string {
  if (value === null) {
    return '-';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
