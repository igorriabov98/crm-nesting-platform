export const COMPLETED_PROJECT_STATUSES = ['done', 'completed_with_warnings'] as const;

type CompletedProjectStatus = (typeof COMPLETED_PROJECT_STATUSES)[number];

type ValidationReportForStatus = {
  violations: Array<{ severity?: 'info' | 'warning' | 'error' }>;
};

export function isCompletedProjectStatus(status: string | null | undefined): boolean {
  return Boolean(status && COMPLETED_PROJECT_STATUSES.includes(status as (typeof COMPLETED_PROJECT_STATUSES)[number]));
}

export function resolveCompletedProjectStatus(
  validationReport: ValidationReportForStatus,
  hasUnplacedParts: boolean
): CompletedProjectStatus {
  const hasNonInfoViolations = validationReport.violations.some((violation) => violation.severity !== 'info');
  return hasNonInfoViolations || hasUnplacedParts ? 'completed_with_warnings' : 'done';
}
