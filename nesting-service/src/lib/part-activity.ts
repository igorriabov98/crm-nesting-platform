import { isSheetPartType } from './part-type';

export type PartActivityReason = 'HIDDEN_IN_CAD' | 'MANUAL';

export type ActivityPart = {
  quantity: number;
  isActive?: boolean | null;
  isSheetMetal?: boolean | null;
  partType?: string | null;
};

export function isPartActive(part: { isActive?: boolean | null }): boolean {
  return part.isActive !== false;
}

export function getActivityQuantity(part: ActivityPart, projectQuantity = 1): number {
  const quantity = Math.max(0, Math.round(part.quantity || 0));
  const bodyQuantity = isSheetPartType(part.partType, part.isSheetMetal)
    ? quantity
    : Math.min(quantity, 1);

  return bodyQuantity * projectQuantity;
}

export function summarizePartActivity(parts: ActivityPart[], projectQuantity = 1): {
  totalBodies: number;
  activeParts: number;
  inactiveParts: number;
} {
  return parts.reduce(
    (summary, part) => {
      const quantity = getActivityQuantity(part, projectQuantity);
      summary.totalBodies += quantity;
      if (isPartActive(part)) {
        summary.activeParts += quantity;
      } else {
        summary.inactiveParts += quantity;
      }
      return summary;
    },
    { totalBodies: 0, activeParts: 0, inactiveParts: 0 }
  );
}

export function inactiveReasonText(reason: PartActivityReason | string | null | undefined): string {
  switch (reason) {
    case 'HIDDEN_IN_CAD':
      return 'скрыто в CAD';
    case 'MANUAL':
      return 'выключено вручную';
    default:
      return 'неактивна';
  }
}
