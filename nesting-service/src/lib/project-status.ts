export const COMPLETED_PROJECT_STATUSES = ['done', 'completed_with_warnings'] as const;

export function isCompletedProjectStatus(status: string | null | undefined): boolean {
  return Boolean(status && COMPLETED_PROJECT_STATUSES.includes(status as (typeof COMPLETED_PROJECT_STATUSES)[number]));
}
