import { isSheetPartType } from '../part-type';

export function isNestingCandidate(part: {
  needsReview?: boolean;
  partType?: string | null;
  isSheetMetal?: boolean | null;
}): boolean {
  return part.needsReview !== true && isSheetPartType(part.partType, part.isSheetMetal);
}
