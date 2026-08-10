export type CuttingAreaFileCategory = 'assembly' | 'general' | 'step'

export type CuttingAreaItemFileBinding = {
  productId: string | null
  productVersionId: string | null
  productProjectId: string | null
  productProjectVersionId: string | null
}

export type CuttingAreaFileBinding =
  | { kind: 'product'; productId: string; productVersionId: string | null; fileKind: string }
  | { kind: 'project'; productProjectId: string; productProjectVersionId: string | null; fileKind: string }
  | { kind: 'production_drawing'; productVersionId: string; fileKind: 'pdf' }

export function isCuttingAreaFileForItem(
  item: CuttingAreaItemFileBinding,
  file: CuttingAreaFileBinding,
) {
  if (file.kind === 'product') {
    return item.productId === file.productId
      && (!file.productVersionId || item.productVersionId === file.productVersionId)
  }

  if (file.kind === 'project') {
    return item.productProjectId === file.productProjectId
      && (!file.productProjectVersionId || item.productProjectVersionId === file.productProjectVersionId)
  }

  return item.productVersionId === file.productVersionId
}

export function cuttingAreaFileCategory(file: CuttingAreaFileBinding): CuttingAreaFileCategory {
  if (file.fileKind === 'step') return 'step'
  if (file.kind === 'production_drawing' || file.fileKind === 'other') return 'general'
  return 'assembly'
}
