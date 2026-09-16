export type MachineCuttingUploadPolicyInput = {
  userId: string
  canManage: boolean
  canBypassOwnership: boolean
  isArchived: boolean
  completionCreatedBy: string | null
}

export function canUploadMachineCutting(input: MachineCuttingUploadPolicyInput) {
  return Boolean(
    input.canManage &&
    !input.isArchived &&
    input.completionCreatedBy &&
    (input.completionCreatedBy === input.userId || input.canBypassOwnership),
  )
}
