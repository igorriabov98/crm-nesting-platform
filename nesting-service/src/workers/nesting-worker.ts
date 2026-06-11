import { getBoss, QUEUE_NESTING_CALCULATION, stopBoss } from '../lib/queue';
import type { NestingCalculationJobData } from '../lib/queue';
import { runNesting } from '../lib/nesting/engine';
import { prisma } from '../lib/prisma';

type NestingJob = {
  id: string;
  data: NestingCalculationJobData;
};

async function processNestingJob(job: NestingJob) {
  const { projectId } = job.data;
  console.log(`[nesting-worker] Job ${job.id} started, project: ${projectId}`);

  try {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    });

    if (!project) {
      throw new Error(`Проект ${projectId} не найден`);
    }

    if (project.status !== 'calculating') {
      console.log(`[nesting-worker] Project ${projectId} has status ${project.status}, skipping`);
      return { status: 'skipped', reason: `Project status is ${project.status}` };
    }

    const result = await runNesting(projectId);

    console.log(`[nesting-worker] Job ${job.id} completed`);
    console.log(`  Sheets: ${result.totalSheets}`);
    console.log(`  Placed: ${result.placedParts}/${result.totalParts}`);
    console.log(`  Avg utilization: ${result.avgUtilization}%`);
    console.log(`  Compute time: ${result.computeTimeMs}ms`);

    if (result.unplacedParts.length > 0) {
      console.log(`  Unplaced: ${result.unplacedParts.map((part) => part.name).join(', ')}`);
    }

    return {
      status: 'completed',
      sheets: result.totalSheets,
      placed: result.placedParts,
      total: result.totalParts,
      utilization: result.avgUtilization,
      computeTimeMs: result.computeTimeMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[nesting-worker] Job ${job.id} failed:`, message);

    await prisma.nestingProject
      .update({
        where: { id: projectId },
        data: {
          status: 'error',
          errorMessage: truncateErrorMessage(`Ошибка раскладки: ${message}`),
        },
      })
      .catch((dbError) => {
        console.error('[nesting-worker] Failed to update project status:', dbError);
      });

    throw error;
  }
}

async function main() {
  const boss = await getBoss();

  const handleJobs = async (jobs: NestingJob[]) => {
    const results = [];

    for (const job of jobs) {
      results.push(await processNestingJob(job));
    }

    return results.length === 1 ? results[0] : results;
  };

  await Promise.all([
    boss.work<NestingCalculationJobData>(QUEUE_NESTING_CALCULATION, { batchSize: 1 }, handleJobs),
    boss.work<NestingCalculationJobData>(QUEUE_NESTING_CALCULATION, { batchSize: 1 }, handleJobs),
  ]);

  console.log('[nesting-worker] Started, waiting for jobs...');

  const shutdown = async (signal: string) => {
    console.log(`[nesting-worker] ${signal} received, shutting down...`);
    await stopBoss();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

function truncateErrorMessage(message: string): string {
  return message.length > 4000 ? `${message.slice(0, 3997)}...` : message;
}

main().catch((err) => {
  console.error('[nesting-worker] Failed to start:', err);
  process.exit(1);
});
