import type { BOMEntry, SteelTypeCatalogItem } from './types';

type ResolvedSteelType = Pick<BOMEntry, 'steelTypeRaw' | 'steelTypeId' | 'steelTypeName' | 'steelTypeWarning'>;

export function resolveBOMSteelTypes(
  bom: BOMEntry[],
  steelTypes: SteelTypeCatalogItem[] = []
): BOMEntry[] {
  return bom.map((entry) => ({
    ...entry,
    ...resolveSteelTypeForEntry(entry, steelTypes),
  }));
}

export function resolveSteelTypeForEntry(
  entry: Pick<BOMEntry, 'material' | 'notes' | 'steelTypeRaw'>,
  steelTypes: SteelTypeCatalogItem[] = []
): ResolvedSteelType {
  const raw = firstNonEmpty([
    entry.steelTypeRaw,
    extractCatalogSteelType(entry.material, steelTypes),
    extractCatalogSteelType(entry.notes, steelTypes),
    extractCommonSteelMark(entry.material),
    extractCommonSteelMark(entry.notes),
  ]);

  if (!raw) {
    return {
      steelTypeRaw: null,
      steelTypeId: null,
      steelTypeName: null,
      steelTypeWarning: null,
    };
  }

  const normalizedRaw = normalizeSteelTypeName(raw);
  const matches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);

  if (matches.length === 1) {
    return {
      steelTypeRaw: raw,
      steelTypeId: matches[0].id,
      steelTypeName: matches[0].name,
      steelTypeWarning: null,
    };
  }

  if (matches.length > 1) {
    return {
      steelTypeRaw: raw,
      steelTypeId: null,
      steelTypeName: null,
      steelTypeWarning: `Неоднозначный тип стали в CRM: ${raw}`,
    };
  }

  return {
    steelTypeRaw: raw,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: `Тип стали не найден в CRM: ${raw}`,
  };
}

export function normalizeSteelTypeName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[х]/g, 'x')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function extractCatalogSteelType(value: string | null | undefined, steelTypes: SteelTypeCatalogItem[]): string | null {
  if (!value || steelTypes.length === 0) return null;

  const normalizedTokens = new Set(
    String(value)
      .split(/[^A-Za-zА-Яа-я0-9]+/)
      .map((token) => normalizeSteelTypeName(token))
      .filter(Boolean)
  );

  const matches = steelTypes.filter((steelType) => normalizedTokens.has(normalizeSteelTypeName(steelType.name)));
  return matches.length === 1 ? matches[0].name : null;
}

function extractCommonSteelMark(value: string | null | undefined): string | null {
  const source = String(value ?? '');
  const match = source.match(/\b(?:s235|s355|hardox|aisi\s*304|aisi\s*316|09г2с|ст3)\b/i);
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed && !isNotSpecified(trimmed)) return trimmed;
  }
  return null;
}

function isNotSpecified(value: string): boolean {
  const normalized = normalizeSteelTypeName(value);
  return normalized === '' || normalized === '-' || normalized === 'неуказан' || normalized === 'notspecified';
}
