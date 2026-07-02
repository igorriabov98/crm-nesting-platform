import type { Prisma } from '@prisma/client';

type DimensionedPart = {
  name?: string | null;
  width: number;
  height: number;
};

type DimensionGuardOptions = {
  force?: boolean;
  blockOnMismatch?: boolean;
};

type DimensionGuardResult<T extends Record<string, unknown>> = {
  data: T & Prisma.PartUpdateInput;
  blocked: boolean;
  dimensionsApplied: boolean;
  mismatch: boolean;
  note: string | null;
};

// PDF dimensions may override STEP only when both area and aspect ratio stay within 2%.
export const DIMENSION_MISMATCH_TOLERANCE = 0.02;

export function isDimensionChangeSafe(part: DimensionedPart, newWidth: number, newHeight: number): boolean {
  const currentArea = part.width * part.height;
  const nextArea = newWidth * newHeight;
  const currentAspect = part.width / part.height;
  const nextAspect = newWidth / newHeight;

  return (
    isPositiveFinite(part.width) &&
    isPositiveFinite(part.height) &&
    isPositiveFinite(newWidth) &&
    isPositiveFinite(newHeight) &&
    ratioDelta(currentArea, nextArea) <= DIMENSION_MISMATCH_TOLERANCE &&
    ratioDelta(currentAspect, nextAspect) <= DIMENSION_MISMATCH_TOLERANCE
  );
}

export function applyDimensionGuard<T extends Record<string, unknown>>(
  data: T,
  part: DimensionedPart,
  newWidth: number | null | undefined,
  newHeight: number | null | undefined,
  options: DimensionGuardOptions = {}
): DimensionGuardResult<T> {
  if (!isPositiveFinite(newWidth) || !isPositiveFinite(newHeight)) {
    return {
      data: data as T & Prisma.PartUpdateInput,
      blocked: false,
      dimensionsApplied: false,
      mismatch: false,
      note: null,
    };
  }

  if (isDimensionChangeSafe(part, newWidth, newHeight) || options.force === true) {
    return {
      data: {
        ...data,
        width: newWidth,
        height: newHeight,
        dimensionMismatch: false,
        mismatchNote: null,
      },
      blocked: false,
      dimensionsApplied: true,
      mismatch: false,
      note: null,
    };
  }

  const note = buildDimensionMismatchNote(part, newWidth, newHeight);
  if (options.blockOnMismatch) {
    return {
      data: data as T & Prisma.PartUpdateInput,
      blocked: true,
      dimensionsApplied: false,
      mismatch: true,
      note,
    };
  }

  return {
    data: {
      ...data,
      dimensionMismatch: true,
      mismatchNote: note,
    },
    blocked: false,
    dimensionsApplied: false,
    mismatch: true,
    note,
  };
}

export function buildDimensionMismatchNote(part: DimensionedPart, newWidth: number, newHeight: number): string {
  const currentArea = part.width * part.height;
  const nextArea = newWidth * newHeight;
  const currentAspect = part.width / part.height;
  const nextAspect = newWidth / newHeight;
  const areaDiff = ratioDelta(currentArea, nextArea) * 100;
  const aspectDiff = ratioDelta(currentAspect, nextAspect) * 100;
  const partName = part.name ? `${part.name}: ` : '';

  return [
    `${partName}PDF предлагает ${formatDimension(newWidth)} x ${formatDimension(newHeight)} мм`,
    `STEP содержит ${formatDimension(part.width)} x ${formatDimension(part.height)} мм`,
    `расхождение площади ${formatPercent(areaDiff)}`,
    `соотношения сторон ${formatPercent(aspectDiff)}`,
  ].join('; ');
}

function ratioDelta(current: number, next: number): number {
  if (!isPositiveFinite(current) || !isPositiveFinite(next)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(next - current) / current;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatDimension(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}%`;
}
