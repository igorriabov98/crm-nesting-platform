import { prisma } from '../prisma';
import {
  areLayoutViolationsValid,
  type LayoutValidationReport,
} from '../validation/layout-validator';
import { AI_RECALC_REQUIRED_MESSAGE } from './apply-control';

export const AI_RECALC_REQUIRED_VIOLATION = 'AI_RECALC_REQUIRED' as const;

type RecalculationProjectUpdate = {
  aiRecalcRequired: true;
  errorMessage: string;
  status?: 'parsed';
};

export function projectRecalculationUpdateForStatus(status: string): RecalculationProjectUpdate {
  if (status === 'calculating') {
    return {
      aiRecalcRequired: true,
      errorMessage: AI_RECALC_REQUIRED_MESSAGE,
    };
  }

  return {
    aiRecalcRequired: true,
    status: 'parsed',
    errorMessage: AI_RECALC_REQUIRED_MESSAGE,
  };
}

export async function markProjectRecalculationRequired(projectId: string): Promise<'calculating' | 'parsed'> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const calculating = await prisma.nestingProject.updateMany({
      where: { id: projectId, status: 'calculating' },
      data: projectRecalculationUpdateForStatus('calculating'),
    });
    if (calculating.count > 0) return 'calculating';

    const parsed = await prisma.nestingProject.updateMany({
      where: { id: projectId, status: { not: 'calculating' } },
      data: projectRecalculationUpdateForStatus('parsed'),
    });
    if (parsed.count > 0) return 'parsed';
  }

  throw new Error(`Не удалось пометить проект ${projectId} для пересчёта`);
}

export function appendProjectRecalculationViolation(
  report: LayoutValidationReport,
  required: boolean
): LayoutValidationReport {
  if (!required) return report;

  const warning = {
    type: AI_RECALC_REQUIRED_VIOLATION,
    partIds: [],
    severity: 'warning' as const,
    message: AI_RECALC_REQUIRED_MESSAGE,
  };
  const violations = [
    warning,
    ...report.violations.filter((violation) => violation.type !== AI_RECALC_REQUIRED_VIOLATION),
  ];

  return {
    ...report,
    valid: areLayoutViolationsValid(violations),
    violations,
  };
}
