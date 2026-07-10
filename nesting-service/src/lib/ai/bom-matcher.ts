import { normalizeSteelTypeName, resolveCatalogSteelType as resolveSteelTypeCatalogEntry } from './steel-types';
import type { BOMEntry, DetailEntry, MatchResult, PartForMatching, PartType, SteelTypeCatalogItem } from './types';
import { mergeUnfoldingWarning, resolveUnfolding } from './unfolding-extraction';
import { isProfileBomPartType, isPurchasedBomSection, isSheetPartType, normalizePartType, partTypeFromLegacySheetFlag } from '../part-type';

type MatchType = MatchResult['matchType'];
type GeometryScore = {
  score: number;
  details: string[];
  strongMatches: number;
};
type MatchCandidate = {
  bomEntry: BOMEntry | null;
  detail: DetailEntry | null;
  matchType: MatchType;
  matchConfidence: number;
  matchDetails: string;
};
type PartGroup = {
  key: string;
  parts: PartForMatching[];
  firstIndex: number;
};
type BomSlot = {
  entry: BOMEntry;
  key: string;
  capacityKey: string;
  remaining: number;
};
type BomSlotAllocation = {
  slot: BomSlot;
  count: number;
};

const STANDARD_THICKNESSES = [
  0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30,
];
const THICKNESS_TOLERANCE_MM = 0.3;
const UNFOLDING_MATCH_TOLERANCE = 0.02;
const UNFOLDING_SUGGESTION_REJECT_TOLERANCE = 0.15;
const DIMENSION_CLUSTER_TOLERANCE_MM = 0.1;

export function matchBOMToParts(
  bom: BOMEntry[],
  parts: PartForMatching[],
  details: DetailEntry[] = [],
  steelTypes: SteelTypeCatalogItem[] = []
): MatchResult[] {
  const detailsByDesignation = buildDesignationMap(details, (detail) => detail.designation);
  const bomSlots: BomSlot[] = bom.map((entry) => ({
    entry,
    key: buildBomKeyFromEntry(entry),
    capacityKey: buildBomCapacityKey(entry),
    remaining: Math.max(1, Math.round(entry.quantity || 1)),
  }));
  const resultsByPartId = new Map<string, MatchResult>();
  const groups = clusterIdenticalParts(parts);

  for (const group of groups) {
    const eligibleBom = bomSlots
      .filter((slot) => slot.remaining > 0 && availableBomCapacity(slot.entry, bomSlots) >= group.parts.length)
      .map((slot) => slot.entry);
    const bomByDesignation = buildDesignationMap(eligibleBom, (entry) => entry.designation);
    const rawMatch = findBestMatch(group.parts[0], eligibleBom, details, detailsByDesignation, bomByDesignation);
    const allocation = rawMatch.bomEntry
      ? planBomSlotAllocation(rawMatch.bomEntry, bomSlots, group.parts.length)
      : [];
    const match = applyGroupQuantitySignal(
      rawMatch.bomEntry && allocation.length === 0
        ? {
            ...rawMatch,
            bomEntry: null,
            matchType: 'none',
            matchConfidence: 0,
            matchDetails: 'qty group: no available BOM capacity',
          }
        : rawMatch,
      group.parts.length,
      allocation.reduce((sum, item) => sum + item.count, 0)
    );

    for (const item of allocation) {
      item.slot.remaining = Math.max(0, item.slot.remaining - item.count);
    }

    let allocationIndex = 0;
    let allocationUsed = 0;
    for (const part of group.parts) {
      while (allocation[allocationIndex] && allocationUsed >= allocation[allocationIndex].count) {
        allocationIndex += 1;
        allocationUsed = 0;
      }
      const allocationItem = allocation[allocationIndex] ?? null;
      const bomEntry = allocationItem?.slot.entry ?? match.bomEntry;
      const assignedGroupSize = allocationItem?.count ?? group.parts.length;
      if (allocationItem) {
        allocationUsed += 1;
      }

      resultsByPartId.set(
        part.id,
        buildMatchResult(
          part,
          bomEntry,
          match.detail,
          match.matchType,
          match.matchConfidence,
          match.matchDetails,
          steelTypes,
          assignedGroupSize
        )
      );
    }
  }

  const orderedResults = parts.map((part) => resultsByPartId.get(part.id) ?? buildMatchResult(part, null, null, 'none', 0, '', steelTypes, 1));
  applyAllocatedSuggestedQuantities(orderedResults, parts, bom);
  return orderedResults;
}

function clusterIdenticalParts(parts: PartForMatching[]): PartGroup[] {
  const groupsByKey = new Map<string, PartGroup>();

  parts.forEach((part, index) => {
    const key = buildPartClusterKey(part);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.parts.push(part);
      return;
    }

    groupsByKey.set(key, {
      key,
      parts: [part],
      firstIndex: index,
    });
  });

  return Array.from(groupsByKey.values()).sort((left, right) => {
    if (right.parts.length !== left.parts.length) {
      return right.parts.length - left.parts.length;
    }
    return left.firstIndex - right.firstIndex;
  });
}

function buildPartClusterKey(part: PartForMatching): string {
  const product = normalizePartClusterName(part.name);
  const dims = getPartBBoxDims(part).map((dim) => quantize(dim, DIMENSION_CLUSTER_TOLERANCE_MM)).join('x');
  const volume = quantizeByRelativeTolerance(part.meshVolume ?? 0, 0.001);

  return [
    product,
    dims,
    volume,
  ].join('|');
}

export function normalizePartClusterName(name: string): string {
  const withoutInstanceSuffix = name
    .trim()
    .replace(/(?:\s*\(\s*\d+\s*\)|[‐‑‒–—−_\-.\s]+\d+)$/u, '')
    .trim();
  return normalize(withoutInstanceSuffix || name);
}

/**
 * Quantity confidence is based on the original BOM row quantity and the matched clone-group size.
 * Allocation only gates the positive boost when BOM qty == group size and every body in that group was allocated.
 * Suggested quantities are handled separately so confidence never leaks the already-consumed allocation count.
 */
function applyGroupQuantitySignal(match: MatchCandidate, groupSize: number, allocatedQuantity?: number): MatchCandidate {
  if (!match.bomEntry || match.matchType === 'none') return match;

  // Confidence is a signal from the original BOM row quantity and the matched clone-group size.
  // It gets the positive boost only when BOM qty equals the group size and allocation covered the whole group.
  const bomQuantity = Math.max(1, Math.round(match.bomEntry.quantity || 1));
  const allocation = Math.max(0, Math.round(allocatedQuantity ?? 0));
  const exactGroupSize = bomQuantity === groupSize && allocation === groupSize;
  const quantityDetails = `qty group: BOM=${bomQuantity}, STEP bodies=${groupSize}, allocated=${allocation}`;
  const matchDetails = [match.matchDetails, quantityDetails].filter(Boolean).join('; ');

  if (exactGroupSize) {
    return {
      ...match,
      matchConfidence: Math.min(1, match.matchConfidence + 0.1),
      matchDetails,
    };
  }

  const mismatchRatio = Math.abs(bomQuantity - groupSize) / Math.max(bomQuantity, groupSize);
  const penalty = Math.min(0.3, 0.1 + mismatchRatio * 0.2);
  return {
    ...match,
    matchConfidence: Math.max(0, match.matchConfidence - penalty),
    matchDetails,
  };
}

function availableBomCapacity(entry: BOMEntry, slots: BomSlot[]): number {
  const capacityKey = buildBomCapacityKey(entry);
  return slots
    .filter((slot) => slot.capacityKey === capacityKey)
    .reduce((sum, slot) => sum + slot.remaining, 0);
}

function planBomSlotAllocation(entry: BOMEntry, slots: BomSlot[], groupSize: number): BomSlotAllocation[] {
  const capacityKey = buildBomCapacityKey(entry);
  const compatible = slots.filter((slot) => slot.capacityKey === capacityKey && slot.remaining > 0);
  if (compatible.reduce((sum, slot) => sum + slot.remaining, 0) < groupSize) {
    return [];
  }

  const plan: BomSlotAllocation[] = [];
  let remaining = groupSize;
  for (const slot of compatible) {
    if (remaining <= 0) break;
    const count = Math.min(slot.remaining, remaining);
    plan.push({ slot, count });
    remaining -= count;
  }

  return remaining === 0 ? plan : [];
}

function findBestMatch(
  part: PartForMatching,
  bom: BOMEntry[],
  details: DetailEntry[],
  detailsByDesignation: Map<string, DetailEntry>,
  bomByDesignation: Map<string, BOMEntry>
): MatchCandidate {
  const rejectedDetails: string[] = [];
  const designationMatch = findDesignationMatch(part, detailsByDesignation, bomByDesignation);

  if (designationMatch) {
    return withThicknessMismatchDetails(part, designationMatch);
  }

  const profileGeometryMatch = findProfileGeometryMatch(part, bom);
  if (profileGeometryMatch) {
    const bomKey = extractDesignationKey(profileGeometryMatch.entry.designation);
    const detail = bomKey ? detailsByDesignation.get(bomKey) ?? null : null;
    return {
      bomEntry: profileGeometryMatch.entry,
      detail,
      matchType: 'geometry',
      matchConfidence: profileGeometryMatch.confidence,
      matchDetails: profileGeometryMatch.details,
    };
  }

  const nameMatch = findNameMatch(part, bom, rejectedDetails);
  if (nameMatch) {
    const bomKey = extractDesignationKey(nameMatch.entry.designation);
    const detail = bomKey ? detailsByDesignation.get(bomKey) ?? null : null;
    if (isThicknessCompatibleWithCandidate(part, nameMatch.entry, detail)) {
      return {
        bomEntry: nameMatch.entry,
        detail,
        matchType: nameMatch.type,
        matchConfidence: detail ? Math.max(nameMatch.confidence, 0.7) : nameMatch.confidence,
        matchDetails: nameMatch.details,
      };
    }
    if (nameMatch.type === 'exact') {
      return withThicknessMismatchDetails(part, {
        bomEntry: nameMatch.entry,
        detail,
        matchType: nameMatch.type,
        matchConfidence: detail ? Math.max(nameMatch.confidence, 0.7) : nameMatch.confidence,
        matchDetails: nameMatch.details,
      });
    }
    rejectedDetails.push(buildThicknessRejectedDetails(part, nameMatch.entry, detail));
  }

  const geometryMatch = findGeometryMatch(part, bom, rejectedDetails);
  if (geometryMatch) {
    const bomKey = extractDesignationKey(geometryMatch.entry.designation);
    const detail = bomKey ? detailsByDesignation.get(bomKey) ?? null : null;
    if (isThicknessCompatibleWithCandidate(part, geometryMatch.entry, detail)) {
      return {
        bomEntry: geometryMatch.entry,
        detail,
        matchType: 'geometry',
        matchConfidence: geometryMatch.confidence,
        matchDetails: geometryMatch.details,
      };
    }
    rejectedDetails.push(buildThicknessRejectedDetails(part, geometryMatch.entry, detail));
  }

  const detailMatch = findDetailMatch(part, details, rejectedDetails);
  if (detailMatch) {
    return detailMatch;
  }

  return {
    bomEntry: null,
    detail: null,
    matchType: 'none',
    matchConfidence: 0,
    matchDetails: rejectedDetails[0] ?? '',
  };
}

function withThicknessMismatchDetails(part: PartForMatching, match: MatchCandidate): MatchCandidate {
  if (isThicknessCompatibleWithCandidate(part, match.bomEntry, match.detail)) {
    return match;
  }

  const rejection = buildThicknessRejectedDetails(part, match.bomEntry, match.detail);
  return {
    ...match,
    matchDetails: [match.matchDetails, rejection].filter(Boolean).join('; '),
  };
}

function findDesignationMatch(
  part: PartForMatching,
  detailsByDesignation: Map<string, DetailEntry>,
  bomByDesignation: Map<string, BOMEntry>
): MatchCandidate | null {
  const partDesignation = extractDesignationKey(part.name);
  if (!partDesignation) return null;

  const suffix = extractTrailingSuffix(part.name);
  const suffixKey = suffix ? `${partDesignation.replace(/-\d{2,3}$/, '')}-${suffix}` : null;
  let bomEntry = suffixKey ? bomByDesignation.get(suffixKey) ?? null : null;
  let detail = suffixKey ? detailsByDesignation.get(suffixKey) ?? null : null;
  let matchConfidence = 0;
  let matchDetails = '';

  if (detail || bomEntry) {
    matchConfidence = 0.95;
    matchDetails = 'designation suffix match';
  }

  bomEntry = bomEntry ?? bomByDesignation.get(partDesignation) ?? null;
  detail = detail ?? detailsByDesignation.get(partDesignation) ?? null;

  if (detail || bomEntry) {
    matchConfidence = Math.max(matchConfidence, 0.95);
    matchDetails = matchDetails || 'designation match';
  }

  if (!detail || !bomEntry) {
    if (suffix) {
      const fullKey = `${partDesignation.replace(/-\d{2,3}$/, '')}-${suffix}`;
      detail = detail ?? detailsByDesignation.get(fullKey) ?? null;
      bomEntry = bomEntry ?? bomByDesignation.get(fullKey) ?? null;
      if (detail || bomEntry) {
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
        matchConfidence = Math.max(matchConfidence, 0.8);
        matchDetails = 'designation base match';
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

  if (!detail && !bomEntry) return null;

  return {
    bomEntry,
    detail,
    matchType: 'designation',
    matchConfidence,
    matchDetails,
  };
}

function findGeometryMatch(
  part: PartForMatching,
  bom: BOMEntry[],
  rejectedDetails: string[] = []
): { entry: BOMEntry; confidence: number; details: string } | null {
  let bestMatch: { entry: BOMEntry; confidence: number; details: string; strongMatches: number } | null = null;

  for (const entry of bom) {
    if (!isThicknessCompatibleWithCandidate(part, entry, null)) {
      rejectedDetails.push(buildThicknessRejectedDetails(part, entry, null));
      continue;
    }

    const geometry = geometryMatchScore(part, entry);
    if (geometry.score < 0.45 || geometry.strongMatches === 0) {
      const rejection = geometry.details.find((item) => item.startsWith('unfolding rejected'));
      if (rejection) {
        rejectedDetails.push(rejection);
      }
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

function findProfileGeometryMatch(
  part: PartForMatching,
  bom: BOMEntry[]
): { entry: BOMEntry; confidence: number; details: string } | null {
  const stepDims = getPartBBoxDims(part);
  const stepType = classifyPartType(part, stepDims);
  if (!isProfilePartType(stepType)) return null;

  let bestMatch: { entry: BOMEntry; confidence: number; details: string; strongMatches: number } | null = null;

  for (const entry of bom) {
    if (!isExplicitNonSheetProfile(entry)) continue;
    const bomDims = getBOMDimensions(entry);
    if (!profilePartTypesCompatible(stepType, bomDims.partType)) continue;

    const geometry = profileGeometryMatchScore(part, entry, stepType, stepDims);
    if (geometry.score < 0.75 || geometry.strongMatches < 2) continue;

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

function findDetailMatch(
  part: PartForMatching,
  details: DetailEntry[],
  rejectedDetails: string[] = []
): MatchCandidate | null {
  let bestMatch: MatchCandidate | null = null;

  for (const detail of details) {
    if (!isThicknessCompatibleWithCandidate(part, null, detail)) {
      rejectedDetails.push(buildThicknessRejectedDetails(part, null, detail));
      continue;
    }

    const geometry = detailGeometryMatchScore(part, detail);
    if (geometry.score < 0.8 || geometry.strongMatches < 2) {
      const rejection = geometry.details.find((item) => item.startsWith('unfolding rejected'));
      if (rejection) {
        rejectedDetails.push(rejection);
      }
      continue;
    }

    if (!bestMatch || geometry.score > bestMatch.matchConfidence) {
      bestMatch = {
        bomEntry: null,
        detail,
        matchType: 'geometry',
        matchConfidence: geometry.score,
        matchDetails: `detail_geometry: ${geometry.details.join('; ')}`,
      };
    }
  }

  return bestMatch;
}

function profileGeometryMatchScore(
  part: PartForMatching,
  bom: BOMEntry,
  stepType: BOMEntry['partType'],
  stepDims: number[]
): GeometryScore {
  const details: string[] = [];
  let score = 0;
  let strongMatches = 0;
  const bomDims = getBOMDimensions(bom);
  const usedStepDims = new Set<number>();
  const characteristicDim = bomDims.widthMm;
  const lengthDim = bomDims.heightMm;

  if (characteristicDim) {
    const best = findClosestDim(characteristicDim, stepDims, usedStepDims);
    if (best && best.diff <= 0.15) {
      usedStepDims.add(best.index);
      score += 0.45;
      strongMatches += 1;
      details.push(`dim: profile size BOM=${formatNumber(characteristicDim)} ~= STEP=${formatNumber(stepDims[best.index])}`);
    }
  }

  if (lengthDim) {
    const best = findClosestDim(lengthDim, stepDims, usedStepDims);
    if (best && best.diff <= 0.15) {
      usedStepDims.add(best.index);
      score += 0.45;
      strongMatches += 1;
      details.push(`dim: profile length BOM=${formatNumber(lengthDim)} ~= STEP=${formatNumber(stepDims[best.index])}`);
    }
  }

  if (profilePartTypesCompatible(stepType, bomDims.partType)) {
    score += 0.1;
    details.push(`type: ${bomDims.partType}`);
  }

  if (bom.quantity > 0 && part.quantity > 0 && bom.quantity === part.quantity) {
    score += 0.05;
    details.push(`qty: ${bom.quantity}`);
  }

  if (bom.massKg && bom.massKg > 0 && part.meshVolume && part.meshVolume > 0) {
    const stepMassKg = part.meshVolume * 7.85 / 1e6;
    if (sizeMatch(bom.massKg, stepMassKg, 0.25)) {
      score += 0.05;
      strongMatches += 1;
      details.push(`mass: BOM=${formatNumber(bom.massKg)}kg ~= STEP=${formatNumber(stepMassKg)}kg`);
    }
  }

  return {
    score: Math.min(1, score),
    details,
    strongMatches,
  };
}

function detailGeometryMatchScore(part: PartForMatching, detail: DetailEntry): GeometryScore {
  const details: string[] = [];
  let score = 0;
  let strongMatches = 0;
  const detailDims = getDetailUnfoldingDims(detail);
  const partDims = getPartUnfoldingDims(part);
  const unfoldingMismatch = buildUnfoldingMismatchReason(partDims, detailDims, 'detail');
  if (unfoldingMismatch) {
    return {
      score: 0.5,
      details: [unfoldingMismatch],
      strongMatches: 0,
    };
  }

  if (detail.thicknessMm > 0 && thicknessMatch(detail.thicknessMm, getStepThickness(part))) {
    score += 0.35;
    strongMatches += 1;
    details.push(`thickness: detail=${formatNumber(detail.thicknessMm)} ~= STEP=${formatNumber(getStepThickness(part))}`);
  }

  const usedStepDims = new Set<number>();
  for (const detailDim of detailDims) {
    const best = findClosestDim(detailDim, partDims, usedStepDims);
    if (best && best.diff <= 0.15) {
      usedStepDims.add(best.index);
      score += 0.3;
      strongMatches += 1;
      details.push(`dim: detail=${formatNumber(detailDim)} ~= STEP=${formatNumber(partDims[best.index])}`);
    }
  }

  if (detail.isSheetMetal && part.isSheetMetal) {
    score += 0.05;
    details.push('type: sheet');
  }

  if (detail.massKg && detail.massKg > 0 && part.meshVolume && part.meshVolume > 0) {
    const stepMassKg = part.meshVolume * 7.85 / 1e6;
    if (sizeMatch(detail.massKg, stepMassKg, 0.2)) {
      score += 0.15;
      strongMatches += 1;
      details.push(`mass: detail=${formatNumber(detail.massKg)}kg ~= STEP=${formatNumber(stepMassKg)}kg`);
    }
  }

  const tokenScore = nameTokenScore(normalize(part.name), normalize(detail.name));
  if (tokenScore >= 0.75) {
    score += 0.05;
    details.push('name token match');
  }

  return {
    score: Math.min(1, score),
    details,
    strongMatches,
  };
}

function geometryMatchScore(part: PartForMatching, bom: BOMEntry): GeometryScore {
  const details: string[] = [];
  let score = 0;
  let strongMatches = 0;
  const bomDims = getBOMDimensions(bom);
  const stepDims = getPartBBoxDims(part);
  const dimensionWeight = 0.3;
  const bomUnfoldingDims = [bomDims.widthMm, bomDims.heightMm]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const unfoldingMismatch = bomDims.partType === 'sheet' && part.hasBends
    ? buildUnfoldingMismatchReason(getPartUnfoldingDims(part), bomUnfoldingDims, 'BOM')
    : null;
  if (unfoldingMismatch) {
    return {
      score: 0.5,
      details: [unfoldingMismatch],
      strongMatches: 0,
    };
  }

  if (bomDims.thicknessMm) {
    const stepThickness = getStepThickness(part);
    const wallThickness = getPartWallThickness(part);
    if (thicknessMatch(bomDims.thicknessMm, stepThickness)) {
      score += 0.35;
      strongMatches += 1;
      details.push(`thickness: BOM=${formatNumber(bomDims.thicknessMm)} ~= STEP=${formatNumber(stepThickness)}`);
    } else if (thicknessMatch(bomDims.thicknessMm, wallThickness)) {
      score += 0.25;
      strongMatches += 1;
      details.push(`thickness: BOM=${formatNumber(bomDims.thicknessMm)} ~= STEP_VA=${formatNumber(wallThickness)}`);
    } else {
      return {
        score: 0,
        details: [`thickness rejected: BOM=${formatNumber(bomDims.thicknessMm)}, STEP=${formatNumber(stepThickness)}`],
        strongMatches: 0,
      };
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
    if (bomDims.partType === stepType || isBOMSheetCandidate(bomDims, part, stepDims, strongMatches)) {
      score += bomDims.partType === 'sheet' ? 0.15 : 0.1;
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
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function getPartUnfoldingDims(part: PartForMatching): number[] {
  return [part.width, part.height]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function getDetailUnfoldingDims(detail: DetailEntry): number[] {
  return [detail.unfoldingWidth, detail.unfoldingHeight]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function buildUnfoldingMismatchReason(stepDims: number[], candidateDims: number[], source: string): string | null {
  if (stepDims.length !== 2 || candidateDims.length !== 2) {
    return null;
  }

  const sideDelta = Math.max(
    Math.abs(stepDims[0] - candidateDims[0]) / Math.max(stepDims[0], candidateDims[0]),
    Math.abs(stepDims[1] - candidateDims[1]) / Math.max(stepDims[1], candidateDims[1])
  );
  const areaDelta = Math.abs(stepDims[0] * stepDims[1] - candidateDims[0] * candidateDims[1]) / Math.max(stepDims[0] * stepDims[1], candidateDims[0] * candidateDims[1]);
  const delta = Math.max(sideDelta, areaDelta);

  if (delta <= UNFOLDING_MATCH_TOLERANCE) {
    return null;
  }

  return `unfolding rejected: ${source}=${formatNumber(candidateDims[0])}x${formatNumber(candidateDims[1])}, STEP=${formatNumber(stepDims[0])}x${formatNumber(stepDims[1])}, mismatch=${formatNumber(delta * 100)}%`;
}

function getPartWallThickness(part: PartForMatching): number {
  if (part.meshVolume && part.meshArea && part.meshVolume > 0 && part.meshArea > 0) {
    const wallThickness = (part.meshVolume * 2) / part.meshArea;
    if (Number.isFinite(wallThickness) && wallThickness > 0) {
      return roundToStandardThickness(wallThickness);
    }
  }

  return getStepThickness(part);
}

function getStepThickness(part: PartForMatching): number {
  return typeof part.thickness === 'number' ? part.thickness : 0;
}

function isThicknessCompatibleWithCandidate(
  part: PartForMatching,
  bomEntry: BOMEntry | null,
  detail: DetailEntry | null
): boolean {
  const candidatePartType = resolveCandidatePartType(bomEntry, detail);
  if (candidatePartType && candidatePartType !== 'SHEET') return true;
  const candidateThickness = getCandidateThickness(bomEntry, detail);
  if (!candidateThickness) return true;
  return thicknessMatch(candidateThickness, getStepThickness(part));
}

function getCandidateThickness(bomEntry: BOMEntry | null, detail: DetailEntry | null): number | null {
  if (detail?.thicknessMm && detail.thicknessMm > 0) return detail.thicknessMm;
  const bomThickness = bomEntry?.thicknessMm ?? bomEntry?.thickness ?? null;
  return bomThickness && bomThickness > 0 ? bomThickness : null;
}

function buildThicknessRejectedDetails(part: PartForMatching, bomEntry: BOMEntry | null, detail: DetailEntry | null): string {
  const candidateThickness = getCandidateThickness(bomEntry, detail);
  if (!candidateThickness) return '';
  return `thickness rejected: BOM=${formatNumber(candidateThickness)} mm, STEP=${formatNumber(getStepThickness(part))} mm`;
}

function sizeMatch(a: number, b: number, tolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b) / Math.max(a, b);
  return diff <= tolerance;
}

function thicknessMatch(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.abs(a - b) <= THICKNESS_TOLERANCE_MM;
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

  if (isSheetLikeGeometry(part, stepDims)) {
    return 'sheet';
  }

  if (name.includes('уголок') || name.includes('angle') || name.includes('winkel')) {
    return 'angle';
  }

  if (minD && maxD && minD / maxD < 0.12 && !part.isSheetMetal) {
    return 'channel';
  }

  if (part.isSheetMetal) {
    return 'sheet';
  }

  return 'other';
}

function isBOMSheetCandidate(
  bomDims: ReturnType<typeof getBOMDimensions>,
  part: PartForMatching,
  stepDims: number[],
  strongMatches: number
): boolean {
  if (bomDims.partType !== 'sheet') return false;
  const inferredType = classifyPartType(part, stepDims);
  if (inferredType === 'sheet') return true;
  if (inferredType !== 'other') return false;
  return strongMatches >= 2 && getPartWallThickness(part) <= 12;
}

function isSheetLikeGeometry(part: PartForMatching, stepDims: number[]): boolean {
  const [minD, midD, maxD] = stepDims;
  if (!minD || !midD || !maxD) return false;
  if (part.isSheetMetal) return true;

  const ratio = minD / maxD;
  if (minD <= 12 && midD >= 80 && ratio <= 0.08) {
    return true;
  }

  return minD >= 12 && minD <= 30 && midD >= 45 && maxD <= 350 && ratio <= 0.16;
}

function roundToStandardThickness(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return STANDARD_THICKNESSES.reduce((closest, current) => {
    const currentDiff = Math.abs(current - raw);
    const closestDiff = Math.abs(closest - raw);
    return currentDiff < closestDiff ? current : closest;
  });
}

function normalizePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function findNameMatch(
  part: PartForMatching,
  bom: BOMEntry[],
  rejectedDetails: string[] = []
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

    const tokenScore = nameTokenScore(partName, entryName);
    if (tokenScore >= 0.75 && (!bestMatch || tokenScore > bestMatch.confidence)) {
      bestMatch = { entry, type: 'contains', confidence: Math.min(0.92, tokenScore), details: 'name token match' };
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
  steelTypes: SteelTypeCatalogItem[],
  assignedGroupSize: number
): MatchResult {
  const candidatePartType = resolveCandidatePartType(bomEntry, detail);
  const currentPartType = getCurrentPartType(part);
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
    steelTypeWarning: candidatePartType && candidatePartType !== 'SHEET' ? null : bomEntry?.steelTypeWarning || null,
    suggestedQuantity: null,
    suggestedThickness: null,
    suggestedUnfoldingWidth: null,
    suggestedUnfoldingHeight: null,
    suggestedIsSheetMetal: null,
    suggestedPartType: null,
    suggestedHasBends: null,
    suggestedMassKg: null,
    thicknessMismatch: false,
    thicknessMismatchNote: null,
    detailNotes: '',
    autoApplied: false,
  };
  const sheetMaterialSignal = hasSheetMaterialSignal(detail, bomEntry);
  const detailUnfolding = detail
    ? resolveUnfolding({
        text: [detail.notes, detail.materialFull, detail.name, bomEntry?.description].filter(Boolean).join('\n'),
        providedWidth: detail.unfoldingWidth,
        providedHeight: detail.unfoldingHeight,
        referenceDimsMm: getPartBBoxDims(part),
      })
    : null;
  const detailHasUnfolding = Boolean(detailUnfolding?.width && detailUnfolding.height);
  const detailUnfoldingCompatible = Boolean(
    detailUnfolding?.width &&
    detailUnfolding.height &&
    isUnfoldingSuggestionCompatible(part, detailUnfolding.width, detailUnfolding.height)
  );

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

    if (detail.thicknessMm > 0 && Math.abs(detail.thicknessMm - getStepThickness(part)) > 0.1) {
      result.suggestedThickness = detail.thicknessMm;
    }

    if (detailUnfoldingCompatible && detailUnfolding) {
      result.suggestedUnfoldingWidth = detailUnfolding.width;
      result.suggestedUnfoldingHeight = detailUnfolding.height;
    }

    if ((detail.isSheetMetal || sheetMaterialSignal) && !isSheetPartType(currentPartType, part.isSheetMetal)) {
      result.suggestedIsSheetMetal = true;
    }

    if (detail.isSheetMetal || sheetMaterialSignal) {
      result.suggestedHasBends = detailUnfoldingCompatible && detailUnfolding
        ? computeSheetHasBends(part, detail.thicknessMm, detailUnfolding.width!, detailUnfolding.height!)
        : part.hasBends;
    }

    result.suggestedMassKg = detail.massKg;
    result.detailNotes = mergeUnfoldingWarning(detail.notes, detailUnfolding?.warnings ?? []);
  } else if ((bomEntry?.thicknessMm || bomEntry?.thickness) && Math.abs((bomEntry.thicknessMm ?? bomEntry.thickness ?? 0) - getStepThickness(part)) > 0.1) {
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

    if (bomEntry.partType === 'sheet' || sheetMaterialSignal) {
      result.suggestedIsSheetMetal = true;
      if (bomEntry.thicknessMm && Math.abs(bomEntry.thicknessMm - getStepThickness(part)) > 0.1) {
        result.suggestedThickness = bomEntry.thicknessMm;
      }
      if (bomEntry.widthMm && bomEntry.heightMm) {
        result.suggestedUnfoldingWidth = bomEntry.widthMm;
        result.suggestedUnfoldingHeight = bomEntry.heightMm;
        result.suggestedHasBends = computeSheetHasBends(part, bomEntry.thicknessMm, bomEntry.widthMm, bomEntry.heightMm);
      }
    } else if (isExplicitNonSheetProfile(bomEntry) && !detail?.isSheetMetal && !detailHasUnfolding && !sheetMaterialSignal) {
      result.suggestedIsSheetMetal = false;
      result.suggestedHasBends = false;
    }

    if (bomEntry.massKg) {
      result.suggestedMassKg = result.suggestedMassKg ?? bomEntry.massKg;
    }
  }

  applyPartTypeSuggestion(result, candidatePartType, currentPartType);
  applyThicknessMismatchFlag(result, part, bomEntry, detail);

  return result;
}

function applyThicknessMismatchFlag(
  result: MatchResult,
  part: PartForMatching,
  bomEntry: BOMEntry | null,
  detail: DetailEntry | null
): void {
  const candidatePartType = resolveCandidatePartType(bomEntry, detail);
  if (candidatePartType && candidatePartType !== 'SHEET') return;

  const candidateThickness = getCandidateThickness(bomEntry, detail);
  const stepThickness = getStepThickness(part);
  if (!candidateThickness || thicknessMatch(candidateThickness, stepThickness)) return;

  result.thicknessMismatch = true;
  result.thicknessMismatchNote = buildThicknessMismatchNote(candidateThickness, stepThickness);
  result.suggestedThickness = null;
}

function buildThicknessMismatchNote(candidateThickness: number, stepThickness: number): string {
  return [
    `чертёж: ${formatNumber(candidateThickness)} мм`,
    `модель STEP: ${formatNumber(stepThickness)} мм`,
    `толщина не будет применена автоматически`,
  ].join('; ');
}

function isUnfoldingSuggestionCompatible(part: PartForMatching, width: number, height: number): boolean {
  const stepDims = getPartUnfoldingDims(part);
  const candidateDims = [width, height]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (stepDims.length !== 2 || candidateDims.length !== 2) return true;

  const sideDelta = Math.max(
    Math.abs(stepDims[0] - candidateDims[0]) / Math.max(stepDims[0], candidateDims[0]),
    Math.abs(stepDims[1] - candidateDims[1]) / Math.max(stepDims[1], candidateDims[1])
  );
  const areaDelta = Math.abs(stepDims[0] * stepDims[1] - candidateDims[0] * candidateDims[1]) / Math.max(stepDims[0] * stepDims[1], candidateDims[0] * candidateDims[1]);

  return Math.max(sideDelta, areaDelta) <= UNFOLDING_SUGGESTION_REJECT_TOLERANCE;
}

function applyPartTypeSuggestion(result: MatchResult, candidatePartType: PartType | null, currentPartType: PartType): void {
  if (!candidatePartType) return;

  if (candidatePartType !== currentPartType || candidatePartType !== 'SHEET') {
    result.suggestedPartType = candidatePartType;
  }

  if (candidatePartType === 'SHEET') {
    result.suggestedIsSheetMetal = currentPartType === 'SHEET' ? result.suggestedIsSheetMetal : true;
    return;
  }

  result.suggestedIsSheetMetal = false;
  result.suggestedHasBends = false;
  result.suggestedThickness = null;
  result.suggestedUnfoldingWidth = null;
  result.suggestedUnfoldingHeight = null;
  result.thicknessMismatch = false;
  result.thicknessMismatchNote = null;
  result.steelTypeWarning = null;
  result.suggestedSteelTypeId = null;
  result.suggestedSteelTypeName = null;
}

function getCurrentPartType(part: PartForMatching): PartType {
  return normalizePartType(part.partType, partTypeFromLegacySheetFlag(part.isSheetMetal));
}

function resolveCandidatePartType(bomEntry: BOMEntry | null, detail: DetailEntry | null): PartType | null {
  const sheetMaterialSignal = hasSheetMaterialSignal(detail, bomEntry);

  if (bomEntry) {
    if (isPurchasedBomSection(bomEntry.bomSection)) return 'PURCHASED';
    if (bomEntry.partType === 'sheet' || sheetMaterialSignal) return 'SHEET';
  }

  if (detail?.isSheetMetal || sheetMaterialSignal) return 'SHEET';
  if (bomEntry && isExplicitNonSheetProfile(bomEntry)) return 'PROFILE';
  return null;
}

function hasSheetMaterialSignal(detail: DetailEntry | null, bomEntry: BOMEntry | null): boolean {
  const sources = [
    detail?.materialFull,
    detail?.notes,
    bomEntry?.description,
    bomEntry?.name,
    bomEntry?.material,
    bomEntry?.materialGrade,
    bomEntry?.norm,
    bomEntry?.notes,
  ].filter((value): value is string => Boolean(value));

  return sources.some((source) => /(?:\bлист\b|бт?\s*-\s*пн|sheet|blech)/iu.test(source));
}

function isExplicitNonSheetProfile(bomEntry: BOMEntry): boolean {
  if (!isProfileBomPartType(bomEntry.partType)) return false;
  if (hasSheetMaterialSignal(null, bomEntry)) return false;
  return true;
}

function isProfilePartType(partType: BOMEntry['partType']): boolean {
  return partType === 'channel' || partType === 'round_bar' || partType === 'tube' || partType === 'flat_bar' || partType === 'angle';
}

function profilePartTypesCompatible(stepType: BOMEntry['partType'], bomType: BOMEntry['partType']): boolean {
  if (stepType === 'round_bar') return bomType === 'round_bar';
  if (stepType === 'angle') return bomType === 'angle';
  return bomType === 'channel' || bomType === 'tube' || bomType === 'flat_bar';
}

function getDistributedSuggestedQuantity(
  part: PartForMatching,
  bomQuantity: number,
  matchedGroupSize: number
): number | null {
  // Quantity signal has three faces:
  // 1. confidence uses the original BOM row qty vs the clone-group size; allocation only gates the full-match boost;
  // 2. suggestedQuantity is the distributed per-body share and stays null when share equals current qty or no body was allocated;
  // 3. the invariant is that all per-body shares across the matched group sum back to the original BOM row qty.
  const groupSize = Math.max(1, matchedGroupSize);
  const perBodyQuantity = bomQuantity / groupSize;

  if (!Number.isInteger(perBodyQuantity) || perBodyQuantity < 1) {
    return null;
  }

  return perBodyQuantity !== part.quantity ? perBodyQuantity : null;
}

function applyAllocatedSuggestedQuantities(
  results: MatchResult[],
  parts: PartForMatching[],
  bom: BOMEntry[]
): void {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const quantityByKey = new Map(bom.map((entry) => [
    buildBomKeyFromEntry(entry),
    Math.max(1, Math.round(entry.quantity || 1)),
  ]));
  const resultsByBomKey = new Map<string, MatchResult[]>();

  for (const result of results) {
    if (result.matchType === 'none') {
      continue;
    }

    const key = buildBomKey(result.bomPosition, result.bomDesignation, result.bomName);
    if (!quantityByKey.has(key)) {
      continue;
    }

    const list = resultsByBomKey.get(key) ?? [];
    list.push(result);
    resultsByBomKey.set(key, list);
  }

  for (const [key, matchedResults] of resultsByBomKey) {
    const bomQuantity = quantityByKey.get(key) ?? 0;
    const perBodyQuantity = matchedResults.length > 0 && bomQuantity % matchedResults.length === 0
      ? bomQuantity / matchedResults.length
      : null;

    for (const result of matchedResults) {
      const part = partById.get(result.partId);
      result.suggestedQuantity = part
        ? getDistributedSuggestedQuantity(part, bomQuantity, matchedResults.length)
        : null;
    }
  }
}

function computeSheetHasBends(
  part: PartForMatching,
  thicknessMm: number | null,
  unfoldingWidth: number,
  unfoldingHeight: number
): boolean {
  const stepDims = getPartBBoxDims(part);
  if (stepDims.length < 3 || !thicknessMm) return part.hasBends;

  const hasThicknessAxis = stepDims.some((dim) => sizeMatch(thicknessMm, dim, 0.3));
  if (!hasThicknessAxis) return true;

  const usedDims = new Set<number>();
  const widthMatch = findClosestDim(unfoldingWidth, stepDims, usedDims);
  if (widthMatch && widthMatch.diff <= 0.15) usedDims.add(widthMatch.index);
  const heightMatch = findClosestDim(unfoldingHeight, stepDims, usedDims);

  return !(widthMatch && widthMatch.diff <= 0.15 && heightMatch && heightMatch.diff <= 0.15);
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
  const normalized = str.replace(/[‐‑‒–—−]/g, '-');
  const match = normalized.match(/(\d{3}\.\d{2}\.\d{3})(?:[_\s-]*(\d{2,3}))?/);
  if (match) {
    const base = match[1];
    const suffix = match[2];
    return suffix ? `${base}-${suffix}` : base;
  }

  const prefixed = normalized.match(/([A-Za-zА-Яа-яЁё]{2,}[\s-]*\d{2,3}\.\d{3})(?:[_\s-]*(\d{2,3}))?/u);
  if (!prefixed) return null;
  const base = prefixed[1].replace(/\s+/g, '').toUpperCase();
  const suffix = prefixed[2];
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
  return resolveSteelTypeCatalogEntry(raw, steelTypes).item;
}

function normalize(str: string): string {
  return transliterateCyrillic(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[_\-.]/g, ' ');
}

function nameTokenScore(partName: string, entryName: string): number {
  const partTokens = meaningfulNameTokens(partName);
  const entryTokens = meaningfulNameTokens(entryName);
  if (partTokens.length === 0 || entryTokens.length === 0) return 0;

  const entrySet = new Set(entryTokens);
  const overlap = partTokens.filter((token) => entrySet.has(token)).length;
  if (overlap === 0) return 0;

  return 0.72 + 0.2 * (overlap / Math.min(partTokens.length, entryTokens.length));
}

function meaningfulNameTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !/^\d+$/.test(token));
}

function transliterateCyrillic(value: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  return Array.from(value).map((char) => {
    const lower = char.toLowerCase();
    return map[lower] ?? char;
  }).join('');
}

function buildBomKeyFromEntry(entry: BOMEntry): string {
  return buildBomKey(entry.position, entry.designation, entry.description || entry.name);
}

function buildBomKey(position: string, designation: string, name: string): string {
  return `${position.trim().toLowerCase()}__${designation.trim().toLowerCase()}__${name.trim().toLowerCase()}`;
}

function buildBomCapacityKey(entry: BOMEntry): string {
  return [
    entry.designation.trim().toLowerCase(),
    (entry.description || entry.name).trim().toLowerCase(),
    entry.partType,
    entry.thicknessMm ?? '',
    entry.widthMm ?? '',
    entry.heightMm ?? '',
  ].join('__');
}

function quantize(value: number, tolerance: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value / tolerance));
}

function quantizeByRelativeTolerance(value: number, toleranceRatio: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const tolerance = Math.max(Math.abs(value) * toleranceRatio, 0.001);
  return quantize(value, tolerance);
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
