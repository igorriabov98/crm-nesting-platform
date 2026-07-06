export type PartType = 'SHEET' | 'PROFILE' | 'PURCHASED';

export type PartTypeClassificationMethod = 'bbox' | 'normals' | 'volume_area' | 'heuristic' | 'pdf_bom' | 'manual';

export const PART_TYPES: PartType[] = ['SHEET', 'PROFILE', 'PURCHASED'];

export function isPartType(value: unknown): value is PartType {
  return typeof value === 'string' && PART_TYPES.includes(value as PartType);
}

export function normalizePartType(value: unknown, fallback: PartType = 'SHEET'): PartType {
  if (isPartType(value)) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'sheet' || text === 'листовая' || text === 'лист') return 'SHEET';
  if (text === 'profile' || text === 'профиль' || text === 'профиль/круг') return 'PROFILE';
  if (text === 'purchased' || text === 'покупная' || text === 'покупное') return 'PURCHASED';
  return fallback;
}

export function isSheetPartType(partType: string | null | undefined, isSheetMetal?: boolean | null): boolean {
  if (isPartType(partType)) return partType === 'SHEET';
  return isSheetMetal !== false;
}

export function partTypeFromLegacySheetFlag(isSheetMetal: boolean | null | undefined): PartType {
  return isSheetMetal === false ? 'PROFILE' : 'SHEET';
}

export function partTypeLabel(partType: string | null | undefined): string {
  switch (normalizePartType(partType)) {
    case 'SHEET':
      return 'Листовая';
    case 'PROFILE':
      return 'Профиль';
    case 'PURCHASED':
      return 'Покупная';
  }
}

export function excludedReasonCode(partType: string | null | undefined): 'EXCLUDED_PROFILE' | 'EXCLUDED_PURCHASED' {
  return normalizePartType(partType, 'PROFILE') === 'PURCHASED' ? 'EXCLUDED_PURCHASED' : 'EXCLUDED_PROFILE';
}

export function isPurchasedBomSection(section: string | null | undefined): boolean {
  const normalized = normalizeBomText(section);
  if (!normalized) return false;

  return (
    normalized.includes('прочие изделия') ||
    normalized.includes('стандартные изделия') ||
    normalized.includes('zukaufteile') ||
    normalized.includes('kaufteile') ||
    normalized.includes('standardteile') ||
    normalized.includes('standard parts') ||
    normalized.includes('purchased parts')
  );
}

export function normalizeBomText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isProfileBomPartType(partType: string | null | undefined): boolean {
  return partType === 'channel' || partType === 'round_bar' || partType === 'tube' || partType === 'flat_bar' || partType === 'angle';
}

export function inferPartTypeFromGeometry(input: {
  isSheetMetal: boolean;
  hasBends: boolean;
  bboxSizeX?: number | null;
  bboxSizeY?: number | null;
  bboxSizeZ?: number | null;
}): PartType {
  if (input.isSheetMetal || input.hasBends) return 'SHEET';

  const dims = [input.bboxSizeX, input.bboxSizeY, input.bboxSizeZ]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const maxDim = dims.length > 0 ? Math.max(...dims) : 0;

  return maxDim > 0 && maxDim < 50 ? 'PURCHASED' : 'PROFILE';
}
