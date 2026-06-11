import { prisma } from '../lib/prisma';
import {
  getBoss,
  QUEUE_NESTING_CALCULATION,
  QUEUE_STEP_PARSING,
  type NestingCalculationJobData,
  type StepParsingJobData,
} from '../lib/queue';

export type QueueStats = {
  queued: number;
  active: number;
  failed: number;
  completed: number;
};

export class QueueService {
  async addStepParsingJob(data: StepParsingJobData): Promise<string> {
    const boss = await getBoss();
    const jobId = await boss.send(QUEUE_STEP_PARSING, data, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInMinutes: 5,
      priority: 1,
    });

    if (!jobId) {
      throw new Error(`Failed to add STEP parsing job for project ${data.projectId}`);
    }

    console.log(`[queue] Step parsing job added: ${jobId}, project: ${data.projectId}`);
    return jobId;
  }

  async addNestingJob(data: NestingCalculationJobData): Promise<string> {
    const boss = await getBoss();
    const jobId = await boss.send(QUEUE_NESTING_CALCULATION, data, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInMinutes: 10,
      priority: 1,
    });

    if (!jobId) {
      throw new Error(`Failed to add nesting job for project ${data.projectId}`);
    }

    console.log(`[queue] Nesting job added: ${jobId}, project: ${data.projectId}`);
    return jobId;
  }

  async getQueueStats(): Promise<{
    stepParsing: QueueStats;
    nesting: QueueStats;
  }> {
    const boss = await getBoss();

    const getStats = async (queueName: string): Promise<QueueStats> => {
      const queued = await boss.getQueueSize(queueName);
      return {
        queued: queued || 0,
        active: 0,
        failed: 0,
        completed: 0,
      };
    };

    return {
      stepParsing: await getStats(QUEUE_STEP_PARSING),
      nesting: await getStats(QUEUE_NESTING_CALCULATION),
    };
  }

  async cancelProjectJobs(projectId: string): Promise<void> {
    await Promise.all([
      this.cancelProjectJobsByQueue(QUEUE_STEP_PARSING, projectId),
      this.cancelProjectJobsByQueue(QUEUE_NESTING_CALCULATION, projectId),
    ]);
  }

  private async cancelProjectJobsByQueue(queueName: string, projectId: string): Promise<void> {
    const boss = await getBoss();
    const jobs = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id
      FROM pgboss.job
      WHERE name = ${queueName}
        AND data ->> 'projectId' = ${projectId}
        AND state::text IN ('created', 'retry', 'active')
    `;
    const jobIds = jobs.map((job) => job.id);

    if (jobIds.length === 0) {
      return;
    }

    await boss.cancel(queueName, jobIds).catch(() => undefined);
    await boss.deleteJob(queueName, jobIds).catch(() => undefined);
  }
}

export const queueService = new QueueService();
