import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  appendAIAnalysisViolation,
  BOM_NOT_FOUND_WARNING,
  findAIAnalysisFailureMessage,
  resolvePdfExtraction,
} from '../ai/analysis-state';
import { analyzePDF, parseOpenRouterResponse } from '../ai/openrouter';
import { DEFAULT_AI_MAX_TOKENS, MAX_AI_MAX_TOKENS, type BOMEntry, type DetailEntry } from '../ai/types';

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

const detailEntry: DetailEntry = {
  designation: 'ЭТЛ-03.001',
  name: 'Уголок гнутый',
  materialFull: 'Ст3сп',
  materialType: 'Сталь',
  materialGrade: 'Ст3сп',
  thicknessMm: 2,
  unfoldingWidth: 85.97,
  unfoldingHeight: 100,
  massKg: 0.135,
  isSheetMetal: true,
  notes: 'Внутр. радиус гиба R3. Ширина детали 100.',
  sourcePage: 1,
  source: 'ai',
};

async function main(): Promise<void> {
  assert.equal(DEFAULT_AI_MAX_TOKENS, 32_000, 'the production default must stay below the provider payment ceiling');
  assert.equal(MAX_AI_MAX_TOKENS, 128_000, 'the configurable upper bound must match the model limit');

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

  const tempDir = await mkdtemp(path.join(tmpdir(), 'ai-provider-error-'));
  const pdfPath = path.join(tempDir, 'provider-error.pdf');
  await writeFile(pdfPath, '%PDF-1.4\n%%EOF\n', 'utf8');
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [402, 500]) {
      globalThis.fetch = async () => new Response(
        JSON.stringify({ error: { message: `provider returned ${status}` } }),
        { status, headers: { 'content-type': 'application/json' } }
      );

      const providerFailure = await analyzePDF(pdfPath, {
        configOverride: {
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4.6',
          baseUrl: 'https://openrouter.invalid/api/v1',
        },
      });
      assert.equal(providerFailure.success, false);
      assert.equal(providerFailure.failureKind, 'provider_error');
      assert.equal(providerFailure.maxTokens, DEFAULT_AI_MAX_TOKENS);
      assert.match(providerFailure.error || '', new RegExp(`HTTP ${status}`));

      let providerFallbackCalls = 0;
      const providerResolution = await resolvePdfExtraction(providerFailure, async () => {
        providerFallbackCalls += 1;
        return { bom: [fallbackEntry], details: [] };
      });
      assert.equal(providerFallbackCalls, 1, `HTTP ${status} must invoke deterministic fallback`);
      assert.equal(providerResolution.usable, true);
      assert.equal(providerResolution.audit.status, 'deterministic_fallback');
      assert.equal(providerResolution.audit.failureKind, 'provider_error');
      assert.equal(providerResolution.bom[0].source, 'deterministic-fallback');

      const providerReport = appendAIAnalysisViolation(
        { valid: true, violations: [], checkedAt: 'test' },
        providerResolution.audit
      );
      assert.equal(providerReport.valid, false);
      assert.equal(providerReport.violations[0].type, 'AI_ANALYSIS_FAILED');
      assert.equal(providerReport.violations[0].severity, 'error');
      assert.match(providerReport.violations[0].message, new RegExp(`HTTP ${status}`));
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }

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

  const detailsOnly = parseOpenRouterResponse({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          bom: [],
          details: [{
            designation: detailEntry.designation,
            name: detailEntry.name,
            material_full: detailEntry.materialFull,
            material_type: detailEntry.materialType,
            material_grade: detailEntry.materialGrade,
            thickness_mm: detailEntry.thicknessMm,
            unfolding_width: detailEntry.unfoldingWidth,
            unfolding_height: detailEntry.unfoldingHeight,
            mass_kg: detailEntry.massKg,
            is_sheet_metal: detailEntry.isSheetMetal,
            notes: detailEntry.notes,
          }],
        }),
      },
    }],
    usage: { prompt_tokens: 5_462, completion_tokens: 194, total_tokens: 5_656 },
  }, { model: 'anthropic/claude-sonnet-4.6', maxTokens: 32_000 });
  assert.equal(detailsOnly.success, true);
  assert.equal(detailsOnly.failureKind, null);
  assert.equal(detailsOnly.bom.length, 0);
  assert.equal(detailsOnly.details.length, 1);

  const detailsOnlyResolution = await resolvePdfExtraction(
    detailsOnly,
    async () => ({ bom: [], details: [] })
  );
  assert.equal(detailsOnlyResolution.usable, true);
  assert.equal(detailsOnlyResolution.audit.status, 'completed');
  assert.equal(detailsOnlyResolution.audit.failureKind, null);
  assert.equal(detailsOnlyResolution.audit.warning, BOM_NOT_FOUND_WARNING);

  const detailsOnlyReport = appendAIAnalysisViolation(
    { valid: true, violations: [], checkedAt: 'test' },
    detailsOnlyResolution.audit
  );
  assert.equal(detailsOnlyReport.valid, false);
  assert.equal(detailsOnlyReport.violations[0].type, 'AI_ANALYSIS_WARNING');
  assert.equal(detailsOnlyReport.violations[0].severity, 'warning');
  assert.equal(detailsOnlyReport.violations[0].message, BOM_NOT_FOUND_WARNING);
  assert.equal(findAIAnalysisFailureMessage(detailsOnlyReport), null);

  const emptyBom = parseOpenRouterResponse({
    choices: [{ finish_reason: 'stop', message: { content: '{"bom":[],"details":[]}' } }],
    usage: { completion_tokens: 12, total_tokens: 60 },
  }, { model: 'anthropic/claude-sonnet-4.6', maxTokens: 128_000 });
  assert.equal(emptyBom.failureKind, 'empty_bom');
  const emptyResolution = await resolvePdfExtraction(emptyBom, async () => ({ bom: [], details: [] }));
  assert.equal(emptyResolution.usable, false);
  assert.equal(emptyResolution.audit.status, 'failed');
  assert.match(emptyResolution.audit.warning || '', /не нашёл ни одной строки BOM/);

  const deterministicDetailsResolution = await resolvePdfExtraction(
    emptyBom,
    async () => ({ bom: [], details: [detailEntry] })
  );
  assert.equal(deterministicDetailsResolution.usable, true);
  assert.equal(deterministicDetailsResolution.audit.status, 'completed');
  assert.equal(deterministicDetailsResolution.audit.failureKind, null);
  assert.equal(deterministicDetailsResolution.audit.warning, BOM_NOT_FOUND_WARNING);

  const truncatedWithDetailsResolution = await resolvePdfExtraction(
    { ...truncated, details: [detailEntry] },
    async () => ({ bom: [], details: [detailEntry] })
  );
  assert.equal(truncatedWithDetailsResolution.usable, false);
  assert.equal(truncatedWithDetailsResolution.audit.status, 'failed');
  assert.equal(truncatedWithDetailsResolution.audit.failureKind, 'truncated');

  console.log('[ai-analysis-failure] details-only warning, empty-all failure, strict truncation/provider/parse handling and DXF audit passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
