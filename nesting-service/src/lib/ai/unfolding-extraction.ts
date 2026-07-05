export type UnfoldingResolution = {
  width: number | null;
  height: number | null;
  warnings: string[];
};

type ResolveUnfoldingInput = {
  text?: string | null;
  providedWidth?: number | null;
  providedHeight?: number | null;
  referenceDimsMm?: number[];
  warnOnMissing?: boolean;
};

const UNFOLDING_NOT_RECOGNIZED = 'развёртка не распознана';

export function resolveUnfolding(input: ResolveUnfoldingInput): UnfoldingResolution {
  const text = normalizeText(input.text ?? '');
  const explicit = extractExplicitUnfolding(text);
  const candidate = explicit ?? normalizeProvidedUnfolding(input.providedWidth, input.providedHeight);

  if (!candidate) {
    return {
      width: null,
      height: null,
      warnings: input.warnOnMissing ? [UNFOLDING_NOT_RECOGNIZED] : [],
    };
  }

  if (isGostPair(candidate.width, candidate.height, text)) {
    return { width: null, height: null, warnings: [UNFOLDING_NOT_RECOGNIZED] };
  }

  const maxReference = Math.max(3000, ...(input.referenceDimsMm ?? []).filter(isPositiveFinite));
  const maxAllowed = maxReference * 1.5;
  if (candidate.width > maxAllowed || candidate.height > maxAllowed) {
    return { width: null, height: null, warnings: [UNFOLDING_NOT_RECOGNIZED] };
  }

  return { width: candidate.width, height: candidate.height, warnings: [] };
}

export function extractExplicitUnfolding(text: string): { width: number; height: number } | null {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /разв[её]ртка\s*(?:[:=\-]\s*)?(\d{1,5}(?:[,.]\d+)?)\s*[xх×]\s*(\d{1,5}(?:[,.]\d+)?)\s*(?:мм|mm)?/iu
  );
  if (!match) return null;

  const width = parsePositiveNumber(match[1]);
  const height = parsePositiveNumber(match[2]);
  return width && height ? { width, height } : null;
}

export function mergeUnfoldingWarning(notes: string, warnings: string[]): string {
  const unique = Array.from(new Set([notes, ...warnings].map((value) => value.trim()).filter(Boolean)));
  return unique.join('; ');
}

function normalizeProvidedUnfolding(width: number | null | undefined, height: number | null | undefined): { width: number; height: number } | null {
  return isPositiveFinite(width) && isPositiveFinite(height) ? { width, height } : null;
}

function isGostPair(width: number, height: number, text: string): boolean {
  const widthText = integerText(width);
  const heightText = integerText(height);
  if (!widthText || !heightText) return false;

  const pairPattern = new RegExp(`${escapeRegExp(widthText)}\\s*-\\s*${escapeRegExp(heightText)}`, 'gi');
  for (const match of text.matchAll(pairPattern)) {
    const start = Math.max(0, (match.index ?? 0) - 40);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 40);
    if (/гост/i.test(text.slice(start, end))) {
      return true;
    }
  }

  return false;
}

function integerText(value: number): string | null {
  return Number.isInteger(value) ? String(value) : null;
}

function normalizeText(value: string): string {
  return value
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveNumber(value: string): number | null {
  const number = Number(value.replace(',', '.'));
  return isPositiveFinite(number) ? number : null;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
