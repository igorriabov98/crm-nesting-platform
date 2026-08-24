export const ACTIVE_TASK_STATUSES = ['pending', 'in_progress'] as const
export const ACTIVE_TRANSFER_STATUSES = ['needs_date', 'scheduled', 'partially_received'] as const
export const ACTIVE_OUTSOURCING_NEED_STATUSES = ['open', 'linked'] as const

export function isMachineWorkVisible(
  machineIsArchived: boolean | null | undefined,
  status: string,
  activeStatuses: readonly string[],
) {
  return machineIsArchived !== true || !activeStatuses.includes(status)
}

export function buildNonArchivedOrUnscopedMachineFilter(archivedMachineIds: readonly string[]) {
  if (archivedMachineIds.length === 0) return null
  return `machine_id.is.null,machine_id.not.in.(${archivedMachineIds.join(',')})`
}
