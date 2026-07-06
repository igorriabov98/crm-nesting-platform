import { Prisma } from '@prisma/client';

export const AI_RECALC_REQUIRED_MESSAGE = 'требуется пересчёт после изменения параметров AI';

export type AIApplyStatus =
  | 'suggested'
  | 'applied_auto'
  | 'applied_manual'
  | 'applied_forced'
  | 'needs_force'
  | 'reverted'
  | 'rejected';

export type AIApplySnapshot = {
  material: string;
  steelTypeId: string | null;
  steelTypeName: string | null;
  steelTypeRaw: string | null;
  thickness: number;
  quantity: number;
  width: number;
  height: number;
  isSheetMetal: boolean;
  hasBends: boolean;
  classificationMethod: string | null;
  classificationWarning: string | null;
  appliedBy: string | null;
  appliedAt: string;
  forced: boolean;
};

export type SnapshotPart = {
  material: string;
  steelTypeId: string | null;
  steelTypeName: string | null;
  steelTypeRaw: string | null;
  thickness: number;
  quantity: number;
  width: number;
  height: number;
  isSheetMetal: boolean;
  hasBends: boolean;
  classificationMethod: string | null;
  classificationWarning: string | null;
};

export function buildAIApplySnapshot(
  part: SnapshotPart,
  meta: { appliedBy?: string | null; appliedAt?: Date; forced?: boolean } = {}
): AIApplySnapshot {
  return {
    material: part.material,
    steelTypeId: part.steelTypeId,
    steelTypeName: part.steelTypeName,
    steelTypeRaw: part.steelTypeRaw,
    thickness: part.thickness,
    quantity: part.quantity,
    width: part.width,
    height: part.height,
    isSheetMetal: part.isSheetMetal,
    hasBends: part.hasBends,
    classificationMethod: part.classificationMethod,
    classificationWarning: part.classificationWarning,
    appliedBy: meta.appliedBy ?? null,
    appliedAt: (meta.appliedAt ?? new Date()).toISOString(),
    forced: meta.forced === true,
  };
}

export function parseAIApplySnapshot(value: unknown): AIApplySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AIApplySnapshot>;

  if (
    typeof candidate.material !== 'string' ||
    typeof candidate.thickness !== 'number' ||
    typeof candidate.quantity !== 'number' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    typeof candidate.isSheetMetal !== 'boolean'
  ) {
    return null;
  }

  return {
    material: candidate.material,
    steelTypeId: typeof candidate.steelTypeId === 'string' ? candidate.steelTypeId : null,
    steelTypeName: typeof candidate.steelTypeName === 'string' ? candidate.steelTypeName : null,
    steelTypeRaw: typeof candidate.steelTypeRaw === 'string' ? candidate.steelTypeRaw : null,
    thickness: candidate.thickness,
    quantity: candidate.quantity,
    width: candidate.width,
    height: candidate.height,
    isSheetMetal: candidate.isSheetMetal,
    hasBends: candidate.hasBends === true,
    classificationMethod: typeof candidate.classificationMethod === 'string' ? candidate.classificationMethod : null,
    classificationWarning: typeof candidate.classificationWarning === 'string' ? candidate.classificationWarning : null,
    appliedBy: typeof candidate.appliedBy === 'string' ? candidate.appliedBy : null,
    appliedAt: typeof candidate.appliedAt === 'string' ? candidate.appliedAt : '',
    forced: candidate.forced === true,
  };
}

export function buildRestorePartData(snapshot: AIApplySnapshot): Prisma.PartUpdateInput {
  return {
    material: snapshot.material,
    steelTypeId: snapshot.steelTypeId,
    steelTypeName: snapshot.steelTypeName,
    steelTypeRaw: snapshot.steelTypeRaw,
    thickness: snapshot.thickness,
    quantity: snapshot.quantity,
    width: snapshot.width,
    height: snapshot.height,
    isSheetMetal: snapshot.isSheetMetal,
    hasBends: snapshot.hasBends,
    classificationMethod: snapshot.classificationMethod,
    classificationWarning: snapshot.classificationWarning,
    aiApplySnapshot: Prisma.DbNull,
  };
}

export function hasNestingAffectingChange(data: Prisma.PartUpdateInput): boolean {
  return (
    data.material !== undefined ||
    data.steelTypeId !== undefined ||
    data.steelTypeName !== undefined ||
    data.steelTypeRaw !== undefined ||
    data.thickness !== undefined ||
    data.width !== undefined ||
    data.height !== undefined ||
    data.isSheetMetal !== undefined ||
    data.quantity !== undefined
  );
}

export function hasAIApplyTrackedChange(data: Prisma.PartUpdateInput): boolean {
  return (
    hasNestingAffectingChange(data) ||
    data.hasBends !== undefined ||
    data.classificationMethod !== undefined ||
    data.classificationWarning !== undefined
  );
}

export function hasGeometryAffectingChange(data: Prisma.PartUpdateInput): boolean {
  return (
    data.thickness !== undefined ||
    data.width !== undefined ||
    data.height !== undefined ||
    data.isSheetMetal !== undefined ||
    data.quantity !== undefined
  );
}

export function appendForceAudit(note: string | null, appliedBy: string | null | undefined, appliedAt: Date): string {
  const audit = [
    'применено принудительно',
    appliedBy ? `оператор ${appliedBy}` : null,
    appliedAt.toISOString(),
  ].filter(Boolean).join(', ');

  return [note, audit].filter(Boolean).join('; ');
}

export function applyStatusLabel(status: AIApplyStatus | null | undefined): string {
  switch (status) {
    case 'applied_auto':
      return 'Применено автоматически';
    case 'applied_manual':
      return 'Применено вручную';
    case 'applied_forced':
      return 'Применено принудительно';
    case 'needs_force':
      return 'Требует подтверждения';
    case 'reverted':
      return 'Отменено';
    case 'rejected':
      return 'Отклонено';
    default:
      return 'Предложено';
  }
}
