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
      steelTypeRaw: matches[0].name,
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
  const normalized = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[х]/g, 'x')
    .replace(/[^a-zа-я0-9]+/gi, '');

  const enGrade = normalized.match(/^(s(?:235|355))[a-z0-9]*$/);
  if (enGrade) return enGrade[1];

  return normalized;
}

function extractCatalogSteelType(value: string | null | undefined, steelTypes: SteelTypeCatalogItem[]): string | null {
  if (!value || steelTypes.length === 0) return null;
  const normalizedValue = normalizeSteelTypeName(value);
  const phraseMatches = steelTypes.filter((steelType) => {
    const normalizedName = normalizeSteelTypeName(steelType.name);
    if (!normalizedName || /^\d+$/.test(normalizedName)) return false;
    return normalizedName.length >= 3 && normalizedValue.includes(normalizedName);
  });

  if (phraseMatches.length === 1) {
    return phraseMatches[0].name;
  }

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
  const normalized = normalizeSteelTypeName(source);
  if (normalized === 's235') return 'S235';
  if (normalized === 's355') return 'S355';

  const enGrade = source.match(/\bs(?:235|355)[a-z0-9]*\b/i);
  if (enGrade) {
    return normalizeSteelTypeName(enGrade[0]).toUpperCase();
  }

  const namedMatch = source.match(/\b(?:hardox|aisi\s*304|aisi\s*316|aisi\s*430|12х18н10т|09г2с|ст3сп|ст3пс|ст3|40х|65г)\b/i);
  if (namedMatch) return namedMatch[0].replace(/\s+/g, ' ').trim();

  const numericMatch = source.match(/(?:^|[^\d])(?:сталь\s*)?(10|20|45)(?:[^\d]|$)/i);
  return numericMatch ? numericMatch[1] : null;
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
