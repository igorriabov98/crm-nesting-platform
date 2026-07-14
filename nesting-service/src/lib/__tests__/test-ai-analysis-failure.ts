import assert from 'node:assert/strict';
import { appendAIAnalysisViolation, findAIAnalysisFailureMessage, resolvePdfExtraction } from '../ai/analysis-state';
import { parseOpenRouterResponse } from '../ai/openrouter';
import type { BOMEntry } from '../ai/types';

const fallbackEntry: BOMEntry = {
  articleNumber: '',
  position: '1',
  designation: 'ЛЕДА.228.02.001',
  description: 'Лист передний',
  bomSection: 'Детали',
  partType: 'sheet',
  thicknessMm: 2,
  widthMm: null,
  heightMm: null,
  massKg: null,
  materialGrade: 'Ст3пс',
  materialType: 'Сталь',
  norm: 'ГОСТ 19903-90',
  name: 'Лист передний',
  material: 'Сталь',
  steelTypeRaw: 'Ст3пс',
  steelTypeId: null,
  steelTypeName: null,
  steelTypeWarning: null,
  quantity: 1,
  thickness: 2,
  notes: '',
  sourcePage: 8,
  parentAssembly: 'ЛЕДА.228.02.000',
  sourcePageGroup: 'assembly:леда.228.02.000',
  source: 'deterministic-fallback',
};

async function main(): Promise<void> {
  const truncated = parseOpenRouterResponse({
    choices: [{
      finish_reason: 'length',
      message: { content: '{"bom": [' },
    }],
    usage: { prompt_tokens: 55_448, completion_tokens: 100, total_tokens: 55_548 },
  }, { model: 'anthropic/claude-sonnet-4.6', maxTokens: 100 });

  assert.equal(truncated.success, false);
  assert.equal(truncated.failureKind, 'truncated');
  assert.match(truncated.error || '', /finish_reason=length, completion=100\/100/);

  let fallbackCalls = 0;
  const truncatedResolution = await resolvePdfExtraction(truncated, async () => {
    fallbackCalls += 1;
    return { bom: [fallbackEntry], details: [] };
  });
  assert.equal(fallbackCalls, 1, 'truncation must invoke deterministic fallback');
  assert.equal(truncatedResolution.usable, true);
  assert.equal(truncatedResolution.audit.status, 'deterministic_fallback');
  assert.equal(truncatedResolution.bom[0].source, 'deterministic-fallback');

  const report = appendAIAnalysisViolation({ valid: true, violations: [], checkedAt: 'test' }, truncatedResolution.audit);
  assert.equal(report.valid, false);
  assert.equal(report.violations[0].type, 'AI_ANALYSIS_FAILED');
  assert.equal(report.violations[0].severity, 'error');
  assert.match(report.violations[0].message, /AI response truncated/);
  assert.match(findAIAnalysisFailureMessage(report) || '', /AI response truncated/);

  const parseError = parseOpenRouterResponse({
    choices: [{ finish_reason: 'stop', message: { content: '{not-json' } }],
    usage: { completion_tokens: 42, total_tokens: 100 },
  }, { model: 'anthropic/claude-sonnet-4.6', maxTokens: 128_000 });
  assert.equal(parseError.failureKind, 'parse_error');
  let parseFallbackCalls = 0;
  const parseResolution = await resolvePdfExtraction(parseError, async () => {
    parseFallbackCalls += 1;
    return { bom: [fallbackEntry], details: [] };
  });
  assert.equal(parseFallbackCalls, 1, 'parse error must invoke deterministic fallback');
  assert.equal(parseResolution.audit.status, 'deterministic_fallback');

  const emptyBom = parseOpenRouterResponse({
    choices: [{ finish_reason: 'stop', message: { content: '{"bom":[],"details":[]}' } }],
    usage: { completion_tokens: 12, total_tokens: 60 },
  }, { model: 'anthropic/claude-sonnet-4.6', maxTokens: 128_000 });
  assert.equal(emptyBom.failureKind, 'empty_bom');
  const emptyResolution = await resolvePdfExtraction(emptyBom, async () => ({ bom: [], details: [] }));
  assert.equal(emptyResolution.usable, false);
  assert.equal(emptyResolution.audit.status, 'failed');
  assert.match(emptyResolution.audit.warning || '', /не нашёл ни одной строки BOM/);

  console.log('[ai-analysis-failure] truncation, parse error, empty BOM, fallback and ERROR violation passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
