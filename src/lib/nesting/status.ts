export const nestingStatuses = [
  'created',
  'parsing',
  'parsed',
  'calculating',
  'done',
  'completed_with_warnings',
  'error',
] as const

export type NestingStatus = typeof nestingStatuses[number]
export type CompletedNestingStatus = 'done' | 'completed_with_warnings'

const completedStatuses = new Set<string>(['done', 'completed_with_warnings'])

export function isCompletedNestingStatus(status: string | null | undefined): status is CompletedNestingStatus {
  return Boolean(status && completedStatuses.has(status))
}
