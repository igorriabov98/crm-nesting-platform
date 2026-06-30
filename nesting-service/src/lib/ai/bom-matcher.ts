import { normalizeSteelTypeName } from './steel-types';
import type { BOMEntry, DetailEntry, MatchResult, PartForMatching, SteelTypeCatalogItem } from './types';

type MatchType = MatchResult['matchType'];

export function matchBOMToParts(
  bom: BOMEntry[],
  parts: PartForMatching[],
  details: DetailEntry[] = [],
  steelTypes: SteelTypeCatalogItem[] = []
): MatchResult[] {
  const detailsByDesignation = buildDesignationMap(details, (detail) => detail.designation);
  const bomByDesignation = buildDesignationMap(bom, (entry) => entry.designation);
  const results: MatchResult[] = [];

  for (const part of parts) {
    const match = findBestMatch(part, bom, detailsByDesignation, bomByDesignation);
    results.push(buildMatchResult(part, match.bomEntry, match.detail, match.matchType, match.matchConfidence, steelTypes));
  }

  return suppressAmbiguousQuantitySuggestions(results);
}

function findBestMatch(
  part: PartForMatching,
  bom: BOMEntry[],
  detailsByDesignation: Map<string, DetailEntry>,
  bomByDesignation: Map<string, BOMEntry>
): {
  bomEntry: BOMEntry | null;
  detail: DetailEntry | null;
  matchType: MatchType;
  matchConfidence: number;
} {
  const partDesignation = extractDesignationKey(part.name);
  let bomEntry: BOMEntry | null = null;
  let detail: DetailEntry | null = null;
  let matchType: MatchType = 'none';
  let matchConfidence = 0;

  if (partDesignation) {
    detail = detailsByDesignation.get(partDesignation) ?? null;
    bomEntry = bomByDesignation.get(partDesignation) ?? null;

    if (detail || bomEntry) {
      matchType = 'designation';
      matchConfidence = 0.95;
    }

    if (!detail || !bomEntry) {
      const suffix = extractTrailingSuffix(part.name);
      if (suffix) {
        const fullKey = `${partDesignation.replace(/-\d{2,3}$/, '')}-${suffix}`;
        detail = detail ?? detailsByDesignation.get(fullKey) ?? null;
        bomEntry = bomEntry ?? bomByDesignation.get(fullKey) ?? null;
        if (detail || bomEntry) {
          matchType = 'designation';
          matchConfidence = Math.max(matchConfidence, 0.9);
        }
      }
    }

    if (!detail || !bomEntry) {
      const baseKey = partDesignation.replace(/-\d{2,3}$/, '');
      if (baseKey !== partDesignation) {
        detail = detail ?? detailsByDesignation.get(baseKey) ?? null;
        bomEntry = bomEntry ?? bomByDesignation.get(baseKey) ?? null;
        if (detail || bomEntry) {
          matchType = 'designation';
          matchConfidence = Math.max(matchConfidence, 0.8);
        }
      }
    }
  }

  if (!detail && bomEntry) {
    const bomKey = extractDesignationKey(bomEntry.designation);
    detail = bomKey ? detailsByDesignation.get(bomKey) ?? null : null;
  }

  if (!bomEntry && detail) {
    const detailKey = extractDesignationKey(detail.designation);
    bomEntry = detailKey ? bomByDesignation.get(detailKey) ?? null : null;
  }

  if (!detail && !bomEntry) {
    const nameMatch = findNameMatch(part, bom);
    if (nameMatch) {
      bomEntry = nameMatch.entry;
      matchType = nameMatch.type;
      matchConfidence = nameMatch.confidence;

      const bomKey = extractDesignationKey(bomEntry.designation);
      if (bomKey && detailsByDesignation.has(bomKey)) {
        detail = detailsByDesignation.get(bomKey)!;
        matchConfidence = Math.max(matchConfidence, 0.7);
      }
    }
  }

  return { bomEntry, detail, matchType, matchConfidence };
}

function findNameMatch(
  part: PartForMatching,
  bom: BOMEntry[]
): { entry: BOMEntry; type: MatchType; confidence: number } | null {
  let bestMatch: { entry: BOMEntry; type: MatchType; confidence: number } | null = null;

  for (const entry of bom) {
    const partName = normalize(part.name);
    const entryName = normalize(entry.name);

    if (partName && partName === entryName) {
      return { entry, type: 'exact', confidence: 1 };
    }

    if (partName && entryName && (partName.includes(entryName) || entryName.includes(partName))) {
      const longer = Math.max(partName.length, entryName.length);
      const shorter = Math.min(partName.length, entryName.length);
      const confidence = longer > 0 ? shorter / longer : 0;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { entry, type: 'contains', confidence: Math.min(0.9, confidence) };
      }
    }

    const maxLen = Math.max(partName.length, entryName.length);
    if (maxLen > 0) {
      const distance = levenshtein(partName, entryName);
      if (distance / maxLen < 0.3) {
        const confidence = 1 - distance / maxLen;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { entry, type: 'fuzzy', confidence: Math.min(0.7, confidence) };
        }
      }
    }
  }

  return bestMatch;
}

function buildMatchResult(
  part: PartForMatching,
  bomEntry: BOMEntry | null,
  detail: DetailEntry | null,
  matchType: MatchType,
  matchConfidence: number,
  steelTypes: SteelTypeCatalogItem[]
): MatchResult {
  const result: MatchResult = {
    partId: part.id,
    partName: part.name,
    bomPosition: bomEntry?.position || '',
    bomDesignation: bomEntry?.designation || detail?.designation || '',
    bomName: bomEntry?.name || detail?.name || '',
    matchType,
    matchConfidence,
    suggestedMaterial: null,
    suggestedMaterialGrade: null,
    suggestedSteelTypeId: null,
    suggestedSteelTypeName: null,
    suggestedSteelTypeRaw: null,
    steelTypeWarning: bomEntry?.steelTypeWarning || null,
    suggestedQuantity: null,
    suggestedThickness: null,
    suggestedUnfoldingWidth: null,
    suggestedUnfoldingHeight: null,
    suggestedIsSheetMetal: null,
    suggestedMassKg: null,
    detailNotes: '',
    autoApplied: false,
  };

  const suggestedMaterial = detail?.materialType || (bomEntry ? normalizeMaterial(bomEntry.material) : null);
  if (suggestedMaterial && suggestedMaterial !== part.material) {
    result.suggestedMaterial = suggestedMaterial;
  }

  if (detail) {
    const materialGrade = detail.materialGrade.trim();
    if (materialGrade) {
      result.suggestedMaterialGrade = materialGrade;
      const catalogSteelType = resolveCatalogSteelType(materialGrade, steelTypes);
      if (catalogSteelType && catalogSteelType.id !== part.steelTypeId) {
        result.suggestedSteelTypeId = catalogSteelType.id;
        result.suggestedSteelTypeName = catalogSteelType.name;
        result.suggestedSteelTypeRaw = catalogSteelType.name;
      } else if (!catalogSteelType && !sameSteelType(materialGrade, part.steelTypeRaw) && !sameSteelType(materialGrade, part.steelTypeName)) {
        result.suggestedSteelTypeRaw = materialGrade;
      }
    }

    if (detail.thicknessMm > 0 && Math.abs(detail.thicknessMm - part.thickness) > 0.1) {
      result.suggestedThickness = detail.thicknessMm;
    }

    if (detail.unfoldingWidth && detail.unfoldingHeight) {
      result.suggestedUnfoldingWidth = detail.unfoldingWidth;
      result.suggestedUnfoldingHeight = detail.unfoldingHeight;
    }

    if (detail.isSheetMetal && !part.isSheetMetal) {
      result.suggestedIsSheetMetal = true;
    }

    result.suggestedMassKg = detail.massKg;
    result.detailNotes = detail.notes;
  } else if (bomEntry?.thickness && Math.abs(bomEntry.thickness - part.thickness) > 0.1) {
    result.suggestedThickness = bomEntry.thickness;
  }

  if (bomEntry) {
    if (bomEntry.steelTypeId && bomEntry.steelTypeId !== part.steelTypeId) {
      result.suggestedSteelTypeId = bomEntry.steelTypeId;
      result.suggestedSteelTypeName = bomEntry.steelTypeName;
      result.suggestedSteelTypeRaw = bomEntry.steelTypeRaw;
      result.suggestedMaterialGrade = result.suggestedMaterialGrade || bomEntry.steelTypeRaw;
    } else if (!result.suggestedSteelTypeRaw && bomEntry.steelTypeRaw && !sameSteelType(bomEntry.steelTypeRaw, part.steelTypeRaw)) {
      result.suggestedSteelTypeRaw = bomEntry.steelTypeRaw;
      result.suggestedMaterialGrade = result.suggestedMaterialGrade || bomEntry.steelTypeRaw;
    }

    if (bomEntry.quantity !== part.quantity) {
      result.suggestedQuantity = bomEntry.quantity;
    }
  }

  return result;
}

export function normalizeMaterial(raw: string): string {
  const lower = raw.toLowerCase().trim();

  if (lower.includes('нерж') || lower.includes('12х18') || lower.includes('304') || lower.includes('316') || lower.includes('aisi')) {
    return 'Нержавейка';
  }

  if (lower.includes('алюм') || lower.includes('амг') || lower.includes('ад') || lower.includes('д16') || lower.includes('6061')) {
    return 'Алюминий';
  }

  if (lower.includes('стал') || lower.includes('ст3') || lower.includes('09г2с') || lower.includes('с245') || lower.includes('s235') || lower.includes('s355')) {
    return 'Сталь';
  }

  if (lower === 'не указан' || lower === '' || lower === '-') {
    return 'Сталь';
  }

  return 'Сталь';
}

export function extractDesignationKey(str: string): string | null {
  const match = str.match(/(\d{3}\.\d{2}\.\d{3})(?:[_\s-]*(\d{2,3}))?/);
  if (!match) return null;
  const base = match[1];
  const suffix = match[2];
  return suffix ? `${base}-${suffix}` : base;
}

function buildDesignationMap<T>(entries: T[], getDesignation: (entry: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    const key = extractDesignationKey(getDesignation(entry));
    if (key) map.set(key, entry);
  }
  return map;
}

function extractTrailingSuffix(str: string): string | null {
  const match = str.match(/[_-]+(\d{2,3})(?:\s|$)/);
  return match ? match[1] : null;
}

function sameSteelType(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeSteelType(a);
  const right = normalizeSteelType(b);
  return left.length > 0 && left === right;
}

function resolveCatalogSteelType(raw: string, steelTypes: SteelTypeCatalogItem[]): SteelTypeCatalogItem | null {
  const normalizedRaw = normalizeSteelTypeName(raw);
  if (!normalizedRaw) return null;
  const matches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);
  return matches.length === 1 ? matches[0] : null;
}

function normalizeSteelType(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[х]/g, 'x')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[_\-.]/g, ' ');
}

function suppressAmbiguousQuantitySuggestions(results: MatchResult[]): MatchResult[] {
  const matchesByBom = new Map<string, MatchResult[]>();

  for (const result of results) {
    if (result.matchType === 'none') {
      continue;
    }

    const key = buildBomKey(result.bomPosition, result.bomDesignation, result.bomName);
    matchesByBom.set(key, [...(matchesByBom.get(key) ?? []), result]);
  }

  const ambiguousBomKeys = new Set(
    Array.from(matchesByBom.entries())
      .filter(([, matches]) => matches.length > 1)
      .map(([key]) => key)
  );

  if (ambiguousBomKeys.size === 0) {
    return results;
  }

  return results.map((result) =>
    ambiguousBomKeys.has(buildBomKey(result.bomPosition, result.bomDesignation, result.bomName))
      ? { ...result, suggestedQuantity: null }
      : result
  );
}

function buildBomKey(position: string, designation: string, name: string): string {
  return `${position.trim().toLowerCase()}__${designation.trim().toLowerCase()}__${name.trim().toLowerCase()}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return dp[m][n];
}
