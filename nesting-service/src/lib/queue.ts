import PgBoss from 'pg-boss';
import { config } from '../config';

let boss: PgBoss | null = null;
let startingBoss: Promise<PgBoss> | null = null;

export const QUEUE_STEP_PARSING = 'step-parsing';
export const QUEUE_NESTING_CALCULATION = 'nesting-calculation';

export interface StepParsingJobData {
  projectId: string;
  sourceLabel?: string | null;
  stepFilePath?: string | null;
  pdfFilePath?: string | null;
  stepStorageUri?: string | null;
  pdfStorageUri?: string | null;
  inputs?: Array<{
    sourceInputId: string;
    sourceId: string;
    sourceType: string;
    sourceLabel: string;
    sourceMachineId?: string | null;
    sourceMachineName?: string | null;
    sourceMachineItemId?: string | null;
    sourceProductId?: string | null;
    quantity: number;
    stepFilePath?: string | null;
    pdfFilePath?: string | null;
    stepStorageUri?: string | null;
    pdfStorageUri?: string | null;
  }>;
}

export interface NestingCalculationJobData {
  projectId: string;
}

function getPgBossConnectionString(): string {
  const url = new URL(config.DATABASE_URL);

  if (url.searchParams.get('sslaccept') === 'accept_invalid_certs') {
    url.searchParams.delete('sslaccept');
    url.searchParams.set('sslmode', 'no-verify');
  }

  return url.toString();
}

function isDuplicateQueueError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function ensureQueue(instance: PgBoss, queueName: string): Promise<void> {
  const existing = await instance.getQueue(queueName);
  if (existing) {
    return;
  }

  try {
    await instance.createQueue(queueName);
  } catch (error) {
    if (!isDuplicateQueueError(error)) {
      throw error;
    }
  }
}

async function startBoss(): Promise<PgBoss> {
  const instance = new PgBoss({
    connectionString: getPgBossConnectionString(),
    pollingIntervalSeconds: 2,
    archiveCompletedAfterSeconds: 86400,
    archiveFailedAfterSeconds: 604800,
    deleteAfterDays: 30,
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    monitorStateIntervalSeconds: 30,
  });

  instance.on('error', (error) => {
    console.error('[pg-boss] Error:', error);
  });

  instance.on('monitor-states', (states) => {
    console.log('[pg-boss] Queue states:', JSON.stringify(states));
  });

  try {
    await instance.start();
    await ensureQueue(instance, QUEUE_STEP_PARSING);
    await ensureQueue(instance, QUEUE_NESTING_CALCULATION);
  } catch (error) {
    await instance.stop({ graceful: false }).catch(() => undefined);
    throw error;
  }

  console.log('[pg-boss] Started successfully');
  return instance;
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) {
    return boss;
  }

  if (!startingBoss) {
    startingBoss = startBoss();
  }

  try {
    boss = await startingBoss;
  } finally {
    startingBoss = null;
  }

  return boss;
}

export async function stopBoss(): Promise<void> {
  const instance = boss;
  boss = null;
  startingBoss = null;

  if (!instance) {
    return;
  }

  await instance.stop({ graceful: true, timeout: 30000 });
  console.log('[pg-boss] Stopped');
}
