import type { UnplacedPart, UnplacedReasonCode } from './types';

type UnplacedReasonInput = {
  partId: string;
  baseName: string;
  copyIndex: number;
  reasonCode: UnplacedReasonCode;
  reason: string;
  material?: string | null;
  steelTypeName?: string | null;
  thickness?: number | null;
  requiredWidth?: number | null;
  requiredHeight?: number | null;
};

type ViolationRecord = {
  type?: unknown;
  partIds?: unknown;
  message?: unknown;
  reason?: unknown;
  reasonCode?: unknown;
  material?: unknown;
  steelTypeName?: unknown;
  thickness?: unknown;
  requiredWidth?: unknown;
  requiredHeight?: unknown;
};

const NON_EXCLUDED_UNPLACED_TYPES = new Set([
  'NO_SHEET_AVAILABLE',
  'MISSING_THICKNESS',
  'NESTING_FAILED',
  'UNPLACED_WITHOUT_REASON',
]);

export function createUnplacedPart(input: UnplacedReasonInput): UnplacedPart {
  return {
    partId: input.partId,
    name: formatUnplacedPartName(input.baseName, input.copyIndex, input.reason),
    reasonCode: input.reasonCode,
    reason: input.reason,
    material: input.material ?? null,
    steelTypeName: input.steelTypeName ?? null,
    thickness: input.thickness ?? null,
    requiredWidth: input.requiredWidth ?? null,
    requiredHeight: input.requiredHeight ?? null,
  };
}

export function formatUnplacedPartName(baseName: string, copyIndex: number, reason: string): string {
  return `${baseName} (#${copyIndex}) - ${reason}`;
}

export function buildNoSheetAvailableReason(input: {
  material: string;
  steelTypeName?: string | null;
  thickness: number;
  requiredWidth: number;
  requiredHeight: number;
}): string {
  const materialLabel = [input.material, input.steelTypeName].filter(Boolean).join('/');
  const [longSide, shortSide] = [input.requiredWidth, input.requiredHeight].sort((a, b) => b - a);
  return `нет листа: материал ${materialLabel}, t=${formatMm(input.thickness)}, мин. размер ${formatMm(longSide)}x${formatMm(shortSide)}`;
}

export function buildMissingThicknessReason(input: { material: string; steelTypeName?: string | null }): string {
  const materialLabel = [input.material, input.steelTypeName].filter(Boolean).join('/');
  return `толщина не определена: материал ${materialLabel}`;
}

export function buildNestingFailedReason(input: { material: string; steelTypeName?: string | null; thickness?: number | null }): string {
  const materialLabel = [input.material, input.steelTypeName].filter(Boolean).join('/');
  const thickness = input.thickness ? `, t=${formatMm(input.thickness)}` : '';
  return `не удалось разместить на доступных листах: материал ${materialLabel}${thickness}`;
}

export function buildUnplacedReasonQueues(validationReport: unknown): Map<string, UnplacedPart[]> {
  const queues = new Map<string, UnplacedPart[]>();
  if (!isRecord(validationReport) || !Array.isArray(validationReport.violations)) {
    return queues;
  }

  for (const rawViolation of validationReport.violations) {
    if (!isRecord(rawViolation)) continue;

    const violation = rawViolation as ViolationRecord;
    const type = typeof violation.type === 'string' ? violation.type : '';
    if (!NON_EXCLUDED_UNPLACED_TYPES.has(type)) continue;

    const reasonCode = typeToReasonCode(type);
    const reason = readString(violation.reason) || readString(violation.message) || defaultReason(reasonCode);
    const partIds = Array.isArray(violation.partIds)
      ? violation.partIds.filter((partId): partId is string => typeof partId === 'string' && partId.length > 0)
      : [];

    for (const partId of partIds) {
      const queue = queues.get(partId) ?? [];
      queue.push({
        partId,
        name: '',
        reasonCode,
        reason,
        material: readString(violation.material),
        steelTypeName: readString(violation.steelTypeName),
        thickness: readNumber(violation.thickness),
        requiredWidth: readNumber(violation.requiredWidth),
        requiredHeight: readNumber(violation.requiredHeight),
      });
      queues.set(partId, queue);
    }
  }

  return queues;
}

export function takeUnplacedReason(
  queues: Map<string, UnplacedPart[]>,
  partId: string,
  fallback: Omit<UnplacedPart, 'partId' | 'name'>
): Omit<UnplacedPart, 'partId' | 'name'> {
  const queue = queues.get(partId);
  const next = queue?.shift();
  if (!next) return fallback;

  return {
    reasonCode: next.reasonCode,
    reason: next.reason,
    material: next.material ?? fallback.material ?? null,
    steelTypeName: next.steelTypeName ?? fallback.steelTypeName ?? null,
    thickness: next.thickness ?? fallback.thickness ?? null,
    requiredWidth: next.requiredWidth ?? fallback.requiredWidth ?? null,
    requiredHeight: next.requiredHeight ?? fallback.requiredHeight ?? null,
  };
}

export function fallbackUnplacedReason(): Omit<UnplacedPart, 'partId' | 'name'> {
  return {
    reasonCode: 'UNPLACED_WITHOUT_REASON',
    reason: 'причина не сохранена в результате раскладки',
  };
}

function typeToReasonCode(type: string): UnplacedReasonCode {
  if (type === 'NO_SHEET_AVAILABLE') return 'NO_SHEET_AVAILABLE';
  if (type === 'MISSING_THICKNESS') return 'MISSING_THICKNESS';
  if (type === 'NESTING_FAILED') return 'NESTING_FAILED';
  return 'UNPLACED_WITHOUT_REASON';
}

function defaultReason(reasonCode: UnplacedReasonCode): string {
  switch (reasonCode) {
    case 'NO_SHEET_AVAILABLE':
      return 'нет подходящего листа в справочнике';
    case 'MISSING_THICKNESS':
      return 'толщина не определена';
    case 'NESTING_FAILED':
      return 'не удалось разместить на доступных листах';
    case 'EXCLUDED':
      return 'исключено из листового раскроя';
    case 'UNPLACED_WITHOUT_REASON':
      return 'причина не указана';
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
