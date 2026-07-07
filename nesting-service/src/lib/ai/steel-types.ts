import type { BOMEntry, SteelTypeCatalogItem } from './types';
import { isProfileBomPartType, isPurchasedBomSection } from '../part-type';

type ResolvedSteelType = Pick<BOMEntry, 'steelTypeRaw' | 'steelTypeId' | 'steelTypeName' | 'steelTypeWarning'>;
type CatalogResolution = {
  item: SteelTypeCatalogItem | null;
  warning: string | null;
};

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
  entry: Pick<BOMEntry, 'material' | 'notes' | 'steelTypeRaw'> & Partial<Pick<BOMEntry, 'bomSection' | 'partType' | 'description' | 'name'>>,
  steelTypes: SteelTypeCatalogItem[] = []
): ResolvedSteelType {
  if (isNonSheetReferenceEntry(entry)) {
    return {
      steelTypeRaw: entry.steelTypeRaw ?? null,
      steelTypeId: null,
      steelTypeName: null,
      steelTypeWarning: null,
    };
  }

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

  const resolved = resolveCatalogSteelType(raw, steelTypes);
  if (resolved.item) {
    return {
      steelTypeRaw: resolved.item.name,
      steelTypeId: resolved.item.id,
      steelTypeName: resolved.item.name,
      steelTypeWarning: resolved.warning,
    };
  }

  const strictRaw = normalizeSteelTypeNameStrict(raw);
  const normalizedRaw = normalizeSteelTypeName(raw);
  const ambiguousMatches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);

  if (ambiguousMatches.length > 1) {
    return {
      steelTypeRaw: raw,
      steelTypeId: null,
      steelTypeName: null,
      steelTypeWarning: `Неоднозначный тип стали в CRM: ${raw}`,
    };
  }

  logSteelTypeNotFound(raw, strictRaw, steelTypes);
  return {
    steelTypeRaw: raw,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: `Тип стали не найден в CRM: ${raw}`,
  };
}

function isNonSheetReferenceEntry(
  entry: Pick<BOMEntry, 'material' | 'notes' | 'steelTypeRaw'> & Partial<Pick<BOMEntry, 'bomSection' | 'partType' | 'description' | 'name'>>
): boolean {
  if (isPurchasedBomSection(entry.bomSection)) return true;
  if (!entry.partType || entry.partType === 'sheet') return false;
  if (!isProfileBomPartType(entry.partType)) return false;

  const text = [entry.material, entry.notes, entry.description, entry.name].filter(Boolean).join(' ');
  return !/(?:\bлист\b|бт?\s*-\s*пн|\bbl\b|sheet|blech)/iu.test(text);
}

export function normalizeSteelTypeName(value: string | null | undefined): string {
  const normalized = normalizeSteelTypeNameStrict(value);
  const enGrade = normalized.match(/^(s(?:235|355))[a-z0-9]*$/);
  if (enGrade) return enGrade[1];

  return normalized;
}

export function normalizeSteelTypeNameStrict(value: string | null | undefined): string {
  return normalizeVisualSteelText(value)
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[^a-zа-яё0-9]+/giu, '');
}

export function resolveCatalogSteelType(raw: string, steelTypes: SteelTypeCatalogItem[]): CatalogResolution {
  const strictRaw = normalizeSteelTypeNameStrict(raw);
  if (!strictRaw) {
    return { item: null, warning: null };
  }

  const strictMatches = steelTypes.filter((steelType) => normalizeSteelTypeNameStrict(steelType.name) === strictRaw);
  if (strictMatches.length === 1) {
    return { item: strictMatches[0], warning: null };
  }

  for (const alias of buildSteelTypeAliasChain(strictRaw)) {
    const aliasMatches = steelTypes.filter((steelType) => normalizeSteelTypeNameStrict(steelType.name) === alias);
    if (aliasMatches.length === 1) {
      const silentAlias = /^s235jrg\d*$/i.test(strictRaw) && alias === 's235jr';
      return {
        item: aliasMatches[0],
        warning: silentAlias ? null : `Тип стали применён по алиасу: ${raw} → ${aliasMatches[0].name}`,
      };
    }
  }

  const normalizedRaw = normalizeSteelTypeName(raw);
  const normalizedMatches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);
  if (normalizedMatches.length === 1) {
    const item = normalizedMatches[0];
    const warning = normalizeSteelTypeNameStrict(item.name) === strictRaw
      ? null
      : `Тип стали применён по алиасу: ${raw} → ${item.name}`;
    return { item, warning };
  }

  return { item: null, warning: null };
}

function buildSteelTypeAliasChain(strictRaw: string): string[] {
  if (/^s235jrg\d*$/i.test(strictRaw)) return ['s235jr', 's235'];
  if (/^s235jr[0-9a-z]*$/i.test(strictRaw)) return ['s235jr', 's235'].filter((alias) => alias !== strictRaw);
  if (/^s355j[0-9a-z]*$/i.test(strictRaw)) return ['s355'];
  return [];
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
  const strict = normalizeSteelTypeNameStrict(source);
  if (strict === 's235') return 'S235';
  if (strict === 's355') return 'S355';

  const enGrade = source.match(/\bs(?:235|355)[a-z0-9]*\b/i);
  if (enGrade) {
    return normalizeSteelTypeNameStrict(enGrade[0]).toUpperCase();
  }

  const namedMatch = source.match(/\b(?:hardox|aisi\s*304|aisi\s*316|aisi\s*430|12х18н10т|09г2с|ст3сп|ст3пс|ст3|40х|65г)\b/i);
  if (namedMatch) return namedMatch[0].replace(/\s+/g, ' ').trim();

  const numericMatch = source.match(/(?:^|[^\d])(?:сталь\s*)?(10|20|45)(?:[^\d]|$)/i);
  return numericMatch ? numericMatch[1] : null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = normalizeSteelWhitespace(value);
    if (trimmed && !isNotSpecified(trimmed)) return trimmed;
  }
  return null;
}

function isNotSpecified(value: string): boolean {
  const normalized = normalizeSteelTypeName(value);
  return normalized === '' || normalized === '-' || normalized === 'неуказан' || normalized === 'notspecified';
}

function normalizeVisualSteelText(value: string | null | undefined): string {
  return normalizeSteelWhitespace(value)
    .split(/(\s+)/)
    .map((token) => tokenHasCyrillic(token) ? replaceLatinLookalikes(token) : token)
    .join('');
}

function normalizeSteelWhitespace(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ')
    .trim();
}

function tokenHasCyrillic(value: string): boolean {
  return /[А-Яа-яЁё]/u.test(value);
}

function replaceLatinLookalikes(value: string): string {
  const map: Record<string, string> = {
    A: 'А',
    a: 'а',
    B: 'В',
    C: 'С',
    c: 'с',
    E: 'Е',
    e: 'е',
    H: 'Н',
    K: 'К',
    M: 'М',
    O: 'О',
    P: 'Р',
    p: 'р',
    T: 'Т',
    t: 'т',
    X: 'Х',
    x: 'х',
  };

  return value.replace(/[AaBCCcEeHKMOPpTtXx]/g, (char) => map[char] ?? char);
}

function logSteelTypeNotFound(raw: string, normalizedRaw: string, steelTypes: SteelTypeCatalogItem[]): void {
  const nearest = [...steelTypes]
    .map((steelType) => ({
      name: steelType.name,
      normalized: normalizeSteelTypeNameStrict(steelType.name),
      distance: levenshtein(normalizedRaw, normalizeSteelTypeNameStrict(steelType.name)),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3)
    .map((item) => `${item.name} hex=${toHex(item.name)}`)
    .join('; ');

  console.warn(`[steel-types] not found raw="${raw}" hex=${toHex(raw)} normalized="${normalizedRaw}" nearest=[${nearest}]`);
}

function toHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function levenshtein(left: string, right: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= left.length; i += 1) matrix[i] = [i];
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}
