import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';

export const AI_ANALYSIS_ALREADY_IN_PROGRESS_MESSAGE =
  'Анализ уже выполняется — возвращён результат текущего запуска';

const ANALYSIS_LEASE_MS = 30 * 60 * 1000;
const ANALYSIS_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const ANALYSIS_POLL_MS = 250;

export type ProjectAnalysisClaim = {
  acquired: boolean;
  runId: string;
  startedAt: Date;
};

export type ProjectAnalysisCoordinationDependencies<T> = {
  claim: () => Promise<ProjectAnalysisClaim>;
  release: (runId: string) => Promise<void>;
  waitForResult: (claim: ProjectAnalysisClaim) => Promise<T>;
};

export async function coordinateProjectAnalysis<T>(
  runAnalysis: () => Promise<T>,
  dependencies: ProjectAnalysisCoordinationDependencies<T>
): Promise<{ result: T; alreadyInProgress: boolean }> {
  const claim = await dependencies.claim();
  if (!claim.acquired) {
    return {
      result: await dependencies.waitForResult(claim),
      alreadyInProgress: true,
    };
  }

  try {
    return {
      result: await runAnalysis(),
      alreadyInProgress: false,
    };
  } finally {
    await dependencies.release(claim.runId);
  }
}

export function createPrismaProjectAnalysisCoordination<T>(
  projectId: string,
  loadCompletedResult: (startedAt: Date) => Promise<T | null>
): ProjectAnalysisCoordinationDependencies<T> {
  return {
    claim: () => claimProjectAnalysis(projectId),
    release: (runId) => releaseProjectAnalysis(projectId, runId),
    waitForResult: (claim) => waitForProjectAnalysis(projectId, claim, loadCompletedResult),
  };
}

async function claimProjectAnalysis(projectId: string): Promise<ProjectAnalysisClaim> {
  const runId = randomUUID();
  const startedAt = new Date();
  const staleBefore = new Date(startedAt.getTime() - ANALYSIS_LEASE_MS);
  const claimed = await prisma.nestingProject.updateMany({
    where: {
      id: projectId,
      OR: [
        { aiAnalysisRunId: null },
        { aiAnalysisStartedAt: null },
        { aiAnalysisStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      aiAnalysisRunId: runId,
      aiAnalysisStartedAt: startedAt,
    },
  });

  if (claimed.count > 0) {
    return { acquired: true, runId, startedAt };
  }

  const active = await prisma.nestingProject.findUnique({
    where: { id: projectId },
    select: { aiAnalysisRunId: true, aiAnalysisStartedAt: true },
  });
  if (!active) {
    throw new Error(`Проект ${projectId} не найден`);
  }
  if (!active.aiAnalysisRunId || !active.aiAnalysisStartedAt) {
    return claimProjectAnalysis(projectId);
  }

  return {
    acquired: false,
    runId: active.aiAnalysisRunId,
    startedAt: active.aiAnalysisStartedAt,
  };
}

async function releaseProjectAnalysis(projectId: string, runId: string): Promise<void> {
  await prisma.nestingProject.updateMany({
    where: { id: projectId, aiAnalysisRunId: runId },
    data: {
      aiAnalysisRunId: null,
      aiAnalysisStartedAt: null,
    },
  });
}

async function waitForProjectAnalysis<T>(
  projectId: string,
  claim: ProjectAnalysisClaim,
  loadCompletedResult: (startedAt: Date) => Promise<T | null>
): Promise<T> {
  const deadline = Date.now() + ANALYSIS_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const active = await prisma.nestingProject.findUnique({
      where: { id: projectId },
      select: { aiAnalysisRunId: true },
    });
    if (!active) {
      throw new Error(`Проект ${projectId} не найден`);
    }
    if (!active.aiAnalysisRunId) {
      const result = await loadCompletedResult(claim.startedAt);
      if (result) return result;
      throw new Error('Параллельный AI-анализ завершился без сохранённого результата');
    }

    await delay(ANALYSIS_POLL_MS);
  }

  throw new Error('Анализ уже выполняется и не завершился в отведённое время');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
