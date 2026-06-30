import { normalizeSteelTypeName } from './steel-types';
import type { BOMEntry, DetailEntry, MatchResult, PartForMatching, SteelTypeCatalogItem } from './types';

type MatchType = MatchResult['matchType'];
type GeometryScore = {
  score: number;
  details: string[];
  strongMatches: number;
};

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
    results.push(buildMatchResult(part, match.bomEntry, match.detail, match.matchType, match.matchConfidence, match.matchDetails, steelTypes));
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
  matchDetails: string;
} {
  const partDesignation = extractDesignationKey(part.name);
  let bomEntry: BOMEntry | null = null;
  let detail: DetailEntry | null = null;
  let matchType: MatchType = 'none';
  let matchConfidence = 0;
  let matchDetails = '';

  if (partDesignation) {
    detail = detailsByDesignation.get(partDesignation) ?? null;
    bomEntry = bomByDesignation.get(partDesignation) ?? null;

    if (detail || bomEntry) {
      matchType = 'designation';
      matchConfidence = 0.95;
      matchDetails = 'designation match';
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
          matchDetails = 'designation suffix match';
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
          matchDetails = 'designation base match';
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
    const geometryMatch = findGeometryMatch(part, bom);
    if (geometryMatch) {
      bomEntry = geometryMatch.entry;
      matchType = 'geometry';
      matchConfidence = geometryMatch.confidence;
      matchDetails = geometryMatch.details;

      const bomKey = extractDesignationKey(bomEntry.designation);
      if (bomKey && detailsByDesignation.has(bomKey)) {
        detail = detailsByDesignation.get(bomKey)!;
      }
    }
  }

  if (!detail && !bomEntry) {
    const nameMatch = findNameMatch(part, bom);
    if (nameMatch) {
      bomEntry = nameMatch.entry;
      matchType = nameMatch.type;
      matchConfidence = nameMatch.confidence;
      matchDetails = nameMatch.details;

      const bomKey = extractDesignationKey(bomEntry.designation);
      if (bomKey && detailsByDesignation.has(bomKey)) {
        detail = detailsByDesignation.get(bomKey)!;
        matchConfidence = Math.max(matchConfidence, 0.7);
      }
    }
  }

  return { bomEntry, detail, matchType, matchConfidence, matchDetails };
}

function findGeometryMatch(
  part: PartForMatching,
  bom: BOMEntry[]
): { entry: BOMEntry; confidence: number; details: string } | null {
  let bestMatch: { entry: BOMEntry; confidence: number; details: string; strongMatches: number } | null = null;

  for (const entry of bom) {
    const geometry = geometryMatchScore(part, entry);
    if (geometry.score < 0.45 || geometry.strongMatches === 0) {
      continue;
    }

    if (
      !bestMatch ||
      geometry.score > bestMatch.confidence ||
      (geometry.score === bestMatch.confidence && quantityScore(part, entry) > quantityScore(part, bestMatch.entry))
    ) {
      bestMatch = {
        entry,
        confidence: geometry.score,
        details: geometry.details.join('; '),
        strongMatches: geometry.strongMatches,
      };
    }
  }

  return bestMatch;
}

function geometryMatchScore(part: PartForMatching, bom: BOMEntry): GeometryScore {
  const details: string[] = [];
  let score = 0;
  let strongMatches = 0;
  const bomDims = getBOMDimensions(bom);
  const stepDims = getPartBBoxDims(part);
  const dimensionWeight = bomDims.partType === 'sheet' || bomDims.partType === 'other' ? 0.25 : 0.3;

  if (bomDims.thicknessMm) {
    const wallThickness = getPartWallThickness(part);
    if (sizeMatch(bomDims.thicknessMm, wallThickness, 0.3)) {
      score += 0.3;
      strongMatches += 1;
      details.push(`thickness: BOM=${formatNumber(bomDims.thicknessMm)} ~= STEP_VA=${formatNumber(wallThickness)}`);
    } else if (sizeMatch(bomDims.thicknessMm, part.thickness, 0.3)) {
      score += 0.2;
      strongMatches += 1;
      details.push(`thickness: BOM=${formatNumber(bomDims.thicknessMm)} ~= STEP=${formatNumber(part.thickness)}`);
    } else if (stepDims[0] && sizeMatch(bomDims.thicknessMm, stepDims[0], 0.3)) {
      score += 0.2;
      strongMatches += 1;
      details.push(`thickness: BOM=${formatNumber(bomDims.thicknessMm)} ~= STEP_bbox=${formatNumber(stepDims[0])}`);
    }
  }

  const usedStepDims = new Set<number>();
  for (const bomDim of bomDims.sizeDims) {
    const best = findClosestDim(bomDim, stepDims, usedStepDims);
    if (best && best.diff <= 0.15) {
      usedStepDims.add(best.index);
      score += dimensionWeight;
      strongMatches += 1;
      details.push(`dim: BOM=${formatNumber(bomDim)} ~= STEP=${formatNumber(stepDims[best.index])}`);
    }
  }

  if (bom.quantity > 0 && part.quantity > 0 && bom.quantity === part.quantity) {
    score += 0.15;
    details.push(`qty: ${bom.quantity}`);
  }

  if (bom.massKg && bom.massKg > 0 && part.meshVolume && part.meshVolume > 0) {
    const stepMassKg = part.meshVolume * 7.85 / 1e6;
    if (sizeMatch(bom.massKg, stepMassKg, 0.2)) {
      score += 0.15;
      strongMatches += 1;
      details.push(`mass: BOM=${formatNumber(bom.massKg)}kg ~= STEP=${formatNumber(stepMassKg)}kg`);
    }
  }

  if (bomDims.partType !== 'other') {
    const stepType = classifyPartType(part, stepDims);
    if (bomDims.partType === stepType) {
      score += 0.1;
      details.push(`type: ${bomDims.partType}`);
    }
  }

  return {
    score: Math.min(1, score),
    details,
    strongMatches,
  };
}

function getBOMDimensions(bom: BOMEntry): {
  partType: BOMEntry['partType'];
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  sizeDims: number[];
} {
  const parsed = parseBOMDescription(bom.description || bom.name);
  const partType = bom.partType && bom.partType !== 'other' ? bom.partType : parsed.partType;
  const thicknessMm = bom.thicknessMm ?? bom.thickness ?? parsed.thicknessMm;
  const widthMm = bom.widthMm ?? parsed.widthMm;
  const heightMm = bom.heightMm ?? parsed.heightMm;
  const sizeDims = [widthMm, heightMm].filter((value): value is number => typeof value === 'number' && value > 0);

  return {
    partType,
    thicknessMm,
    widthMm,
    heightMm,
    sizeDims,
  };
}

function parseBOMDescription(description: string): {
  partType: BOMEntry['partType'];
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
} {
  const normalized = description
    .trim()
    .replace(/[×х]/gi, 'x')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/,/g, '.');
  const partType = inferBOMPartType(normalized);
  const numbers = Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
  const pnThickness = normalizePositiveNumber(normalized.match(/\bпн\s*-\s*(\d+(?:[,.]\d+)?)/i)?.[1]);

  if (partType === 'sheet') {
    return { partType, thicknessMm: numbers[0] ?? pnThickness, widthMm: numbers[1] ?? null, heightMm: numbers[2] ?? null };
  }

  if (partType === 'channel' || partType === 'tube' || partType === 'flat_bar') {
    return { partType, thicknessMm: null, widthMm: numbers[0] ?? null, heightMm: numbers.length > 1 ? numbers[numbers.length - 1] : null };
  }

  if (partType === 'round_bar') {
    return { partType, thicknessMm: null, widthMm: numbers[0] ?? null, heightMm: numbers[1] ?? null };
  }

  if (partType === 'angle') {
    return {
      partType,
      thicknessMm: numbers.length >= 4 ? numbers[numbers.length - 2] : numbers[2] ?? null,
      widthMm: numbers[0] ?? null,
      heightMm: numbers.length > 1 ? numbers[numbers.length - 1] : null,
    };
  }

  return { partType, thicknessMm: pnThickness, widthMm: null, heightMm: null };
}

function inferBOMPartType(source: string): BOMEntry['partType'] {
  const lower = source.toLowerCase();
  if (/\b(bl|blech|sheet)\b/.test(lower) || /лист|бт?\s*-\s*пн/i.test(lower)) return 'sheet';
  if (/\b(unp|u)\b/.test(lower) || /швеллер/i.test(lower)) return 'channel';
  if (/\b(l|winkel)\b/.test(lower) || /уголок/i.test(lower)) return 'angle';
  if (/\b(ru|rundstahl|round)\b/.test(lower) || /круг/i.test(lower)) return 'round_bar';
  if (/\b(ro|rohr|tube)\b/.test(lower) || /труба/i.test(lower)) return 'tube';
  if (/\b(fl|flachstahl)\b/.test(lower) || /полоса/i.test(lower)) return 'flat_bar';
  return 'other';
}

function getPartBBoxDims(part: PartForMatching): number[] {
  const bboxDims = [part.bboxSizeX, part.bboxSizeY, part.bboxSizeZ]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  if (bboxDims.length === 3) {
    return bboxDims.sort((a, b) => a - b);
  }

  return [part.thickness, part.width, part.height]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function getPartWallThickness(part: PartForMatching): number {
  return part.thickness;
}

function sizeMatch(a: number, b: number, tolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b) / Math.max(a, b);
  return diff <= tolerance;
}

function findClosestDim(
  bomDim: number,
  stepDims: number[],
  usedStepDims: Set<number>
): { index: number; diff: number } | null {
  let best: { index: number; diff: number } | null = null;

  for (let index = 0; index < stepDims.length; index += 1) {
    if (usedStepDims.has(index)) continue;
    const stepDim = stepDims[index];
    const diff = Math.abs(bomDim - stepDim) / Math.max(bomDim, stepDim);
    if (!best || diff < best.diff) {
      best = { index, diff };
    }
  }

  return best;
}

function quantityScore(part: PartForMatching, bom: BOMEntry): number {
  return bom.quantity > 0 && part.quantity > 0 && bom.quantity === part.quantity ? 1 : 0;
}

function classifyPartType(part: PartForMatching, stepDims: number[]): BOMEntry['partType'] {
  const [minD, midD, maxD] = stepDims;
  const name = normalize(part.name);

  if (name.includes('круг') || name.includes('round') || name.includes('ru')) {
    return 'round_bar';
  }

  if (name.includes('профиль') || name.includes('profile') || name.includes('швеллер') || name.includes('channel')) {
    return 'channel';
  }

  if (minD && midD && maxD && sizeMatch(minD, midD, 0.1) && minD / maxD < 0.45) {
    return 'round_bar';
  }

  if (minD && maxD && minD / maxD < 0.12 && !part.isSheetMetal) {
    return 'channel';
  }

  if (part.isSheetMetal || (minD && maxD && minD / maxD < 0.08)) {
    return 'sheet';
  }

  return 'other';
}

function normalizePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function findNameMatch(
  part: PartForMatching,
  bom: BOMEntry[]
): { entry: BOMEntry; type: MatchType; confidence: number; details: string } | null {
  let bestMatch: { entry: BOMEntry; type: MatchType; confidence: number; details: string } | null = null;

  for (const entry of bom) {
    const partName = normalize(part.name);
    const entryName = normalize(entry.name || entry.description);

    if (partName && partName === entryName) {
      return { entry, type: 'exact', confidence: 1, details: 'name exact match' };
    }

    if (partName && entryName && (partName.includes(entryName) || entryName.includes(partName))) {
      const longer = Math.max(partName.length, entryName.length);
      const shorter = Math.min(partName.length, entryName.length);
      const confidence = longer > 0 ? shorter / longer : 0;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { entry, type: 'contains', confidence: Math.min(0.9, confidence), details: 'name contains match' };
      }
    }

    const maxLen = Math.max(partName.length, entryName.length);
    if (maxLen > 0) {
      const distance = levenshtein(partName, entryName);
      if (distance / maxLen < 0.3) {
        const confidence = 1 - distance / maxLen;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { entry, type: 'fuzzy', confidence: Math.min(0.7, confidence), details: 'name fuzzy match' };
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
  matchDetails: string,
  steelTypes: SteelTypeCatalogItem[]
): MatchResult {
  const result: MatchResult = {
    partId: part.id,
    partName: part.name,
    bomPosition: bomEntry?.position || '',
    bomDesignation: bomEntry?.designation || detail?.designation || '',
    bomName: bomEntry?.description || bomEntry?.name || detail?.name || '',
    matchType,
    matchConfidence,
    matchDetails,
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

  const suggestedMaterial = detail?.materialType || bomEntry?.materialType || (bomEntry ? normalizeMaterial(bomEntry.material) : null);
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
  } else if ((bomEntry?.thicknessMm || bomEntry?.thickness) && Math.abs((bomEntry.thicknessMm ?? bomEntry.thickness ?? 0) - part.thickness) > 0.1) {
    result.suggestedThickness = bomEntry.thicknessMm ?? bomEntry.thickness;
  }

  if (bomEntry) {
    if (!result.suggestedMaterialGrade && bomEntry.materialGrade) {
      result.suggestedMaterialGrade = bomEntry.materialGrade;
    }

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

    if (!result.suggestedUnfoldingWidth && !result.suggestedUnfoldingHeight && bomEntry.partType === 'sheet' && bomEntry.widthMm && bomEntry.heightMm) {
      result.suggestedUnfoldingWidth = bomEntry.widthMm;
      result.suggestedUnfoldingHeight = bomEntry.heightMm;
    }

    if (bomEntry.partType === 'sheet' && !part.isSheetMetal) {
      result.suggestedIsSheetMetal = true;
    }

    if (bomEntry.massKg) {
      result.suggestedMassKg = result.suggestedMassKg ?? bomEntry.massKg;
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
  const left = normalizeSteelTypeName(a);
  const right = normalizeSteelTypeName(b);
  return left.length > 0 && left === right;
}

function resolveCatalogSteelType(raw: string, steelTypes: SteelTypeCatalogItem[]): SteelTypeCatalogItem | null {
  const normalizedRaw = normalizeSteelTypeName(raw);
  if (!normalizedRaw) return null;
  const matches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);
  return matches.length === 1 ? matches[0] : null;
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
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
