export type PartActivityReason = 'HIDDEN_IN_CAD' | 'MANUAL';

export type ActivityPart = {
  quantity: number;
  isActive?: boolean | null;
};

export function isPartActive(part: { isActive?: boolean | null }): boolean {
  return part.isActive !== false;
}

export function summarizePartActivity(parts: ActivityPart[], projectQuantity = 1): {
  totalBodies: number;
  activeParts: number;
  inactiveParts: number;
} {
  return parts.reduce(
    (summary, part) => {
      const quantity = Math.max(0, Math.round(part.quantity || 0)) * projectQuantity;
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
