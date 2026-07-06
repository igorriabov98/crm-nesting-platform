import type { Prisma } from '@prisma/client';

type DimensionedPart = {
  name?: string | null;
  width: number;
  height: number;
};

type ThicknessedPart = {
  name?: string | null;
  thickness: number;
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

type ThicknessGuardResult<T extends Record<string, unknown>> = {
  data: T & Prisma.PartUpdateInput;
  blocked: boolean;
  thicknessApplied: boolean;
  mismatch: boolean;
  note: string | null;
};

// PDF dimensions may override STEP only when both area and aspect ratio stay within 2%.
export const DIMENSION_MISMATCH_TOLERANCE = 0.02;
export const THICKNESS_MISMATCH_TOLERANCE_MM = 0.3;

export function isDimensionChangeSafe(part: DimensionedPart, newWidth: number, newHeight: number): boolean {
  const currentArea = part.width * part.height;
  const nextArea = newWidth * newHeight;
  const currentAspect = normalizedAspect(part.width, part.height);
  const nextAspect = normalizedAspect(newWidth, newHeight);

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

export function isThicknessChangeSafe(part: ThicknessedPart, newThickness: number): boolean {
  return (
    isPositiveFinite(part.thickness) &&
    isPositiveFinite(newThickness) &&
    Math.abs(newThickness - part.thickness) <= THICKNESS_MISMATCH_TOLERANCE_MM
  );
}

export function applyThicknessGuard<T extends Record<string, unknown>>(
  data: T,
  part: ThicknessedPart,
  newThickness: number | null | undefined,
  options: DimensionGuardOptions = {}
): ThicknessGuardResult<T> {
  if (!isPositiveFinite(newThickness)) {
    return {
      data: data as T & Prisma.PartUpdateInput,
      blocked: false,
      thicknessApplied: false,
      mismatch: false,
      note: null,
    };
  }

  if (isThicknessChangeSafe(part, newThickness) || options.force === true) {
    return {
      data: {
        ...data,
        thickness: newThickness,
        thicknessMismatch: false,
        thicknessMismatchNote: null,
      },
      blocked: false,
      thicknessApplied: true,
      mismatch: false,
      note: null,
    };
  }

  const note = buildThicknessMismatchNote(part, newThickness);
  if (options.blockOnMismatch) {
    return {
      data: data as T & Prisma.PartUpdateInput,
      blocked: true,
      thicknessApplied: false,
      mismatch: true,
      note,
    };
  }

  return {
    data: {
      ...data,
      thicknessMismatch: true,
      thicknessMismatchNote: note,
    },
    blocked: false,
    thicknessApplied: false,
    mismatch: true,
    note,
  };
}

export function buildDimensionMismatchNote(part: DimensionedPart, newWidth: number, newHeight: number): string {
  const currentArea = part.width * part.height;
  const nextArea = newWidth * newHeight;
  const currentAspect = normalizedAspect(part.width, part.height);
  const nextAspect = normalizedAspect(newWidth, newHeight);
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

export function buildThicknessMismatchNote(part: ThicknessedPart, newThickness: number): string {
  const partName = part.name ? `${part.name}: ` : '';

  return [
    `${partName}BOM предлагает толщину ${formatDimension(newThickness)} мм`,
    `STEP содержит ${formatDimension(part.thickness)} мм`,
    `допуск ${formatDimension(THICKNESS_MISMATCH_TOLERANCE_MM)} мм`,
  ].join('; ');
}

function ratioDelta(current: number, next: number): number {
  if (!isPositiveFinite(current) || !isPositiveFinite(next)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(next - current) / current;
}

function normalizedAspect(width: number, height: number): number {
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(width, height) / Math.min(width, height);
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
