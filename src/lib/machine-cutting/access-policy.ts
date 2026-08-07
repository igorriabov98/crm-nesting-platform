import { isDirectorRole } from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

export type MachineCuttingUploadPolicyInput = {
  userId: string
  role: UserRole
  canManage: boolean
  isArchived: boolean
  completionCreatedBy: string | null
}

export function canUploadMachineCutting(input: MachineCuttingUploadPolicyInput) {
  return Boolean(
    input.canManage &&
    !input.isArchived &&
    input.completionCreatedBy &&
    (input.completionCreatedBy === input.userId || isDirectorRole(input.role)),
  )
}
