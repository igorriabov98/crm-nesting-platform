import {
  areLayoutViolationsValid,
  type LayoutValidationReport,
  type LayoutViolation,
} from '../validation/layout-validator';
import { mergeDeterministicBOM, mergeDeterministicDetails } from './pdf-bom-fallback';
import type {
  AIAnalysisAudit,
  BOMEntry,
  DetailEntry,
  PDFAnalysisResult,
} from './types';

const STORED_ANALYSIS_VERSION = 1;
export const BOM_NOT_FOUND_WARNING = 'Спецификация не найдена — данные взяты из штампа чертежа, проверьте состав';
const DETERMINISTIC_DATA_WARNING = 'AI не вернул пригодных данных — использован текстовый парсер, проверьте состав';

export type DeterministicPdfData = { bom: BOMEntry[]; details: DetailEntry[] };

export type ResolvedPdfExtraction = {
  usable: boolean;
  bom: BOMEntry[];
  details: DetailEntry[];
  audit: AIAnalysisAudit;
};

type StoredAnalysisEnvelope = {
  __aiAnalysisVersion: number;
  audit: AIAnalysisAudit;
  details: DetailEntry[];
  aiRawResponse: string;
};

export async function resolvePdfExtraction(
  pdfResult: PDFAnalysisResult,
  loadDeterministic: () => Promise<DeterministicPdfData>
): Promise<ResolvedPdfExtraction> {
  const deterministic = await loadDeterministic();

  if (pdfResult.success) {
    const bom = mergeDeterministicBOM(pdfResult.bom, deterministic.bom);
    const details = mergeDeterministicDetails(pdfResult.details, deterministic.details);
    return {
      usable: true,
      bom,
      details,
      audit: buildAudit(
        pdfResult,
        'completed',
        'ai',
        bom.length === 0 && details.length > 0 ? BOM_NOT_FOUND_WARNING : null
      ),
    };
  }

  if (pdfResult.failureKind === 'empty_bom' && (deterministic.bom.length > 0 || deterministic.details.length > 0)) {
    const recoveredResult: PDFAnalysisResult = {
      ...pdfResult,
      success: true,
      failureKind: null,
      error: null,
    };
    const bom = deterministic.bom.map((entry) => ({ ...entry, source: 'deterministic-fallback' as const }));
    const details = deterministic.details.map((entry) => ({ ...entry, source: 'deterministic-fallback' as const }));
    return {
      usable: true,
      bom,
      details,
      audit: buildAudit(
        recoveredResult,
        'completed',
        'deterministic-fallback',
        bom.length === 0 ? BOM_NOT_FOUND_WARNING : DETERMINISTIC_DATA_WARNING
      ),
    };
  }

  if (deterministic.bom.length > 0) {
    const warning = joinSentences(
      `AI-анализ не выполнен: ${pdfResult.error || 'неизвестная ошибка AI'}`,
      'Использован текстовый парсер (deterministic fallback) — результат необходимо проверить'
    );
    return {
      usable: true,
      bom: deterministic.bom.map((entry) => ({ ...entry, source: 'deterministic-fallback' })),
      details: deterministic.details.map((entry) => ({ ...entry, source: 'deterministic-fallback' })),
      audit: buildAudit(pdfResult, 'deterministic_fallback', 'deterministic-fallback', warning),
    };
  }

  const warning = joinSentences(
    `AI-анализ не выполнен: ${pdfResult.error || 'неизвестная ошибка AI'}`,
    'Текстовый парсер (fallback) не нашёл ни одной строки BOM — расчёт раскладки заблокирован'
  );
  return {
    usable: false,
    bom: [],
    details: deterministic.details.map((entry) => ({ ...entry, source: 'deterministic-fallback' })),
    audit: buildAudit(pdfResult, 'failed', 'none', warning),
  };
}

export function serializeStoredAnalysis(
  audit: AIAnalysisAudit,
  details: DetailEntry[],
  aiRawResponse: string
): string {
  const envelope: StoredAnalysisEnvelope = {
    __aiAnalysisVersion: STORED_ANALYSIS_VERSION,
    audit,
    details,
    aiRawResponse,
  };
  return JSON.stringify(envelope);
}

export function parseStoredAnalysis(rawResponse: string): StoredAnalysisEnvelope | null {
  try {
    const parsed = JSON.parse(rawResponse) as unknown;
    if (!isRecord(parsed) || parsed.__aiAnalysisVersion !== STORED_ANALYSIS_VERSION) return null;
    if (!isAIAnalysisAudit(parsed.audit) || !Array.isArray(parsed.details)) return null;
    return {
      __aiAnalysisVersion: STORED_ANALYSIS_VERSION,
      audit: parsed.audit,
      details: parsed.details as DetailEntry[],
      aiRawResponse: typeof parsed.aiRawResponse === 'string' ? parsed.aiRawResponse : '',
    };
  } catch {
    return null;
  }
}

export function appendAIAnalysisViolation(
  report: LayoutValidationReport,
  audit: AIAnalysisAudit | null | undefined
): LayoutValidationReport {
  if (!audit) return report;

  if (audit.status === 'completed') {
    if (!audit.warning) return report;
    const warning: LayoutViolation = {
      type: 'AI_ANALYSIS_WARNING',
      partIds: [],
      severity: 'warning',
      message: audit.warning,
    };
    const violations = [warning, ...report.violations.filter((item) => item.type !== 'AI_ANALYSIS_WARNING')];
    return {
      ...report,
      valid: areLayoutViolationsValid(violations),
      violations,
    };
  }

  const violation: LayoutViolation = {
    type: 'AI_ANALYSIS_FAILED',
    partIds: [],
    severity: 'error',
    message: audit.warning || audit.aiError || 'AI-анализ не выполнен',
  };
  const violations = [violation, ...report.violations.filter((item) => item.type !== 'AI_ANALYSIS_FAILED')];

  return {
    ...report,
    valid: areLayoutViolationsValid(violations),
    violations,
  };
}

export function findAIAnalysisFailureMessage(validationReport: unknown): string | null {
  if (!isRecord(validationReport) || !Array.isArray(validationReport.violations)) return null;
  const violation = validationReport.violations.find(
    (item) => isRecord(item) && item.type === 'AI_ANALYSIS_FAILED' && item.severity === 'error'
  );
  return isRecord(violation) && typeof violation.message === 'string' ? violation.message : null;
}

function buildAudit(
  result: PDFAnalysisResult,
  status: AIAnalysisAudit['status'],
  source: AIAnalysisAudit['source'],
  warning: string | null
): AIAnalysisAudit {
  return {
    status,
    source,
    warning,
    aiError: result.error,
    failureKind: result.failureKind,
    finishReason: result.finishReason,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.tokensUsed,
    maxTokens: result.maxTokens,
  };
}

function joinSentences(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/[.;]+$/, ''))
    .filter(Boolean)
    .join('. ');
}

function isAIAnalysisAudit(value: unknown): value is AIAnalysisAudit {
  if (!isRecord(value)) return false;
  return (
    ['completed', 'deterministic_fallback', 'failed'].includes(String(value.status)) &&
    ['ai', 'deterministic-fallback', 'none'].includes(String(value.source)) &&
    typeof value.promptTokens === 'number' &&
    typeof value.completionTokens === 'number' &&
    typeof value.totalTokens === 'number' &&
    typeof value.maxTokens === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
