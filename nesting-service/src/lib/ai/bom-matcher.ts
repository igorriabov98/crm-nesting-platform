import type { BOMEntry, MatchResult, PartForMatching } from './types';

export function matchBOMToParts(bom: BOMEntry[], parts: PartForMatching[]): MatchResult[] {
  const results: MatchResult[] = [];

  for (const part of parts) {
    let bestMatch: { entry: BOMEntry; type: MatchResult['matchType']; confidence: number } | null = null;

    for (const entry of bom) {
      const partName = normalize(part.name);
      const entryName = normalize(entry.name);

      if (partName && partName === entryName) {
        bestMatch = { entry, type: 'exact', confidence: 1 };
        break;
      }

      if (partName && entryName && (partName.includes(entryName) || entryName.includes(partName))) {
        const longer = Math.max(partName.length, entryName.length);
        const shorter = Math.min(partName.length, entryName.length);
        const confidence = longer > 0 ? shorter / longer : 0;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { entry, type: 'contains', confidence: Math.min(0.9, confidence) };
        }
      }

      const partDesignation = extractDesignation(part.name);
      const bomDesignation = extractDesignation(entry.position) || extractDesignation(entry.name);
      if (partDesignation && bomDesignation && partDesignation === bomDesignation) {
        if (!bestMatch || bestMatch.confidence < 0.85) {
          bestMatch = { entry, type: 'designation', confidence: 0.85 };
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

    if (bestMatch) {
      const suggestedMaterial = normalizeMaterial(bestMatch.entry.material);

      results.push({
        partId: part.id,
        partName: part.name,
        bomPosition: bestMatch.entry.position,
        bomName: bestMatch.entry.name,
        matchType: bestMatch.type,
        matchConfidence: bestMatch.confidence,
        suggestedMaterial: suggestedMaterial !== part.material ? suggestedMaterial : null,
        suggestedSteelTypeId:
          bestMatch.entry.steelTypeId && bestMatch.entry.steelTypeId !== part.steelTypeId
            ? bestMatch.entry.steelTypeId
            : null,
        suggestedSteelTypeName:
          bestMatch.entry.steelTypeId && bestMatch.entry.steelTypeId !== part.steelTypeId
            ? bestMatch.entry.steelTypeName
            : null,
        suggestedSteelTypeRaw:
          bestMatch.entry.steelTypeId && bestMatch.entry.steelTypeId !== part.steelTypeId
            ? bestMatch.entry.steelTypeRaw
            : null,
        steelTypeWarning: bestMatch.entry.steelTypeWarning,
        suggestedQuantity: bestMatch.entry.quantity !== part.quantity ? bestMatch.entry.quantity : null,
        suggestedThickness: bestMatch.entry.thickness,
        autoApplied: false,
      });
    } else {
      results.push({
        partId: part.id,
        partName: part.name,
        bomPosition: '',
        bomName: '',
        matchType: 'none',
        matchConfidence: 0,
        suggestedMaterial: null,
        suggestedSteelTypeId: null,
        suggestedSteelTypeName: null,
        suggestedSteelTypeRaw: null,
        steelTypeWarning: null,
        suggestedQuantity: null,
        suggestedThickness: null,
        autoApplied: false,
      });
    }
  }

  return suppressAmbiguousQuantitySuggestions(results);
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

function normalize(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[_\-.]/g, ' ');
}

function extractDesignation(str: string): string | null {
  const match = str.match(/\d{3}\.\d{2}\.\d{3}/);
  return match ? match[0] : null;
}

function suppressAmbiguousQuantitySuggestions(results: MatchResult[]): MatchResult[] {
  const matchesByBom = new Map<string, MatchResult[]>();

  for (const result of results) {
    if (result.matchType === 'none') {
      continue;
    }

    const key = buildBomKey(result.bomPosition, result.bomName);
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
    ambiguousBomKeys.has(buildBomKey(result.bomPosition, result.bomName))
      ? { ...result, suggestedQuantity: null }
      : result
  );
}

function buildBomKey(position: string, name: string): string {
  return `${position.trim().toLowerCase()}__${name.trim().toLowerCase()}`;
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
