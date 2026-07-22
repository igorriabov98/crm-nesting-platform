import type { Prisma } from '@prisma/client';
import {
  applyDimensionGuard,
  applyThicknessGuard,
  buildDimensionMismatchNote,
  buildThicknessMismatchNote,
  isDimensionChangeSafe,
  isThicknessChangeSafe,
} from './dimension-guard';
import {
  appendForceAudit,
  buildAIApplySnapshot,
  hasAIApplyTrackedChange,
  hasNestingAffectingChange,
  type SnapshotPart,
} from './apply-control';
import { normalizePartType, partTypeFromLegacySheetFlag } from '../part-type';

export type BOMApplyMatchInput = {
  partId: string;
  material?: string;
  steelTypeId?: string | null;
  steelTypeName?: string | null;
  steelTypeRaw?: string | null;
  quantity?: number;
  thickness?: number;
  isSheetMetal?: boolean;
  partType?: 'SHEET' | 'PROFILE' | 'PURCHASED';
  hasBends?: boolean;
  unfoldingWidth?: number;
  unfoldingHeight?: number;
};

export type BOMApplyPart = SnapshotPart & {
  id: string;
  name: string;
};

export type BOMApplyBlockedRow = {
  partId: string;
  partName: string;
  reason: 'thickness_mismatch' | 'dimension_mismatch';
  message: string;
  pdf: {
    thickness?: number | null;
    width?: number | null;
    height?: number | null;
  };
  step: {
    thickness?: number | null;
    width?: number | null;
    height?: number | null;
  };
  requiresForce: true;
  mismatchNote?: string | null;
  thicknessMismatchNote?: string | null;
};

export type BOMApplyPreparedUpdate = {
  partId: string;
  data: Prisma.PartUpdateInput;
  needsUnfoldRecalculation: boolean;
};

export type BOMApplyPrepareResult =
  | { status: 'updated'; update: BOMApplyPreparedUpdate }
  | { status: 'blocked'; blocked: BOMApplyBlockedRow }
  | { status: 'skipped'; partId: string; partName: string };

export function prepareBOMApplyUpdate(
  match: BOMApplyMatchInput,
  part: BOMApplyPart,
  options: {
    force?: boolean;
    appliedBy?: string | null;
    appliedAt?: Date;
  } = {}
): BOMApplyPrepareResult {
  const data: Prisma.PartUpdateInput = {};
  const appliedAt = options.appliedAt ?? new Date();

  const nextPartType = match.partType
    ? normalizePartType(match.partType)
    : match.isSheetMetal !== undefined
      ? partTypeFromLegacySheetFlag(match.isSheetMetal)
      : null;
  const currentPartType = normalizePartType(part.partType, partTypeFromLegacySheetFlag(part.isSheetMetal));
  const effectivePartType = nextPartType ?? currentPartType;

  if (match.material) data.material = match.material;
  if (match.quantity && effectivePartType === 'SHEET') data.quantity = match.quantity;
  if ('steelTypeId' in match) data.steelTypeId = match.steelTypeId ?? null;
  if ('steelTypeName' in match) data.steelTypeName = match.steelTypeName ?? null;
  if ('steelTypeRaw' in match) data.steelTypeRaw = match.steelTypeRaw ?? null;
  if (match.hasBends !== undefined) data.hasBends = match.hasBends;

  if (nextPartType) {
    data.partType = nextPartType;
    data.isSheetMetal = nextPartType === 'SHEET';
    data.classificationMethod = 'pdf_bom';
    data.classificationWarning = null;
    if (nextPartType !== 'SHEET') {
      data.hasBends = false;
      data.grainLock = false;
      data.thicknessMismatch = false;
      data.thicknessMismatchNote = null;
    }
  }

  if (match.unfoldingWidth && match.unfoldingHeight && data.hasBends === undefined) {
    data.hasBends = true;
  }

  const force = options.force === true;
  const forcedThicknessMismatch = force
    && match.thickness !== undefined
    && !isThicknessChangeSafe(part, match.thickness);
  const forcedDimensionMismatch = force
    && match.unfoldingWidth !== undefined
    && match.unfoldingHeight !== undefined
    && !isDimensionChangeSafe(part, match.unfoldingWidth, match.unfoldingHeight);

  const thicknessGuard = applyThicknessGuard(data, part, match.thickness, {
    force,
    blockOnMismatch: true,
  });

  if (thicknessGuard.blocked) {
    return {
      status: 'blocked',
      blocked: {
        partId: match.partId,
        partName: part.name,
        reason: 'thickness_mismatch',
        message: thicknessGuard.note ?? 'Толщина BOM расходится с геометрией STEP',
        pdf: { thickness: match.thickness ?? null },
        step: { thickness: part.thickness ?? null },
        requiresForce: true,
        thicknessMismatchNote: thicknessGuard.note,
      },
    };
  }

  const guarded = applyDimensionGuard(thicknessGuard.data, part, match.unfoldingWidth, match.unfoldingHeight, {
    force,
    blockOnMismatch: true,
  });

  if (guarded.blocked) {
    return {
      status: 'blocked',
      blocked: {
        partId: match.partId,
        partName: part.name,
        reason: 'dimension_mismatch',
        message: guarded.note ?? 'Размеры PDF расходятся с геометрией STEP',
        pdf: {
          width: match.unfoldingWidth ?? null,
          height: match.unfoldingHeight ?? null,
        },
        step: {
          width: part.width,
          height: part.height,
        },
        requiresForce: true,
        mismatchNote: guarded.note,
      },
    };
  }

  if (forcedThicknessMismatch && match.thickness !== undefined) {
    guarded.data.thicknessMismatch = true;
    guarded.data.thicknessMismatchNote = appendForceAudit(
      buildThicknessMismatchNote(part, match.thickness),
      options.appliedBy,
      appliedAt
    );
  }

  if (forcedDimensionMismatch && match.unfoldingWidth !== undefined && match.unfoldingHeight !== undefined) {
    guarded.data.dimensionMismatch = true;
    guarded.data.mismatchNote = appendForceAudit(
      buildDimensionMismatchNote(part, match.unfoldingWidth, match.unfoldingHeight),
      options.appliedBy,
      appliedAt
    );
    guarded.data.contourStale = true;
  } else if (guarded.dimensionsApplied) {
    guarded.data.contourStale = false;
  }

  if (Object.keys(guarded.data).length === 0) {
    return { status: 'skipped', partId: match.partId, partName: part.name };
  }

  if (hasAIApplyTrackedChange(guarded.data, part)) {
    guarded.data.aiApplySnapshot = buildAIApplySnapshot(part, {
      appliedBy: options.appliedBy ?? null,
      appliedAt,
      forced: force,
    }) as unknown as Prisma.InputJsonValue;
  }

  return {
    status: 'updated',
    update: {
      partId: match.partId,
      data: guarded.data,
      needsUnfoldRecalculation: hasNestingAffectingChange(guarded.data, part),
    },
  };
}
