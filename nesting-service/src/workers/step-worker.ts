import type { Prisma } from '@prisma/client';
import { getBoss, QUEUE_STEP_PARSING, stopBoss } from '../lib/queue';
import type { StepParsingJobData } from '../lib/queue';
import { parseStepFile, type ParsedPart } from '../lib/step-parser';
import { prisma } from '../lib/prisma';
import { analyzeProjectPdf } from '../lib/ai/service';
import {
  materializeValidatedStorageObject,
  type MaterializedStorageObject,
} from '../lib/storage';

type StepJob = {
  id: string;
  data: StepParsingJobData;
};

type StepInputContext = {
  sourceInputId: string | null;
  sourceId: string | null;
  sourceType: string | null;
  sourceLabel: string;
  sourceMachineId?: string | null;
  sourceMachineName?: string | null;
  sourceMachineItemId?: string | null;
  sourceProductId?: string | null;
  quantity: number;
  stepFileRef: string;
  pdfFileRef?: string | null;
  isBatch: boolean;
};

function getInputs(data: StepParsingJobData, projectId: string): StepInputContext[] {
  if (data.inputs?.length) {
    return data.inputs.map((input) => {
      const stepFileRef = input.stepStorageUri || input.stepFilePath;
      if (!stepFileRef) throw new Error(`No STEP input provided for ${input.sourceLabel}`);
      return {
        ...input,
        sourceInputId: input.sourceInputId,
        stepFileRef,
        pdfFileRef: input.pdfStorageUri || input.pdfFilePath,
        isBatch: true,
      };
    });
  }

  const stepFileRef = data.stepStorageUri || data.stepFilePath;
  if (!stepFileRef) return [];

  return [{
    sourceInputId: null,
    sourceId: projectId,
    sourceType: 'single_project',
    sourceLabel: 'Single project',
    quantity: 1,
    stepFileRef,
    pdfFileRef: data.pdfStorageUri || data.pdfFilePath,
    isBatch: false,
  }];
}

async function processStepJob(job: StepJob) {
  const { projectId } = job.data;
  const inputs = getInputs(job.data, projectId);

  if (inputs.length === 0) {
    throw new Error('No STEP inputs provided for parsing job');
  }

  console.log(`[step-worker] Job ${job.id} started, project: ${projectId}`);
  console.log(`[step-worker] Inputs: ${inputs.length}`);
  let retainedPdf: MaterializedStorageObject | null = null;

  try {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    });

    if (!project) {
      throw new Error(`Project ${projectId} was not found`);
    }

    if (project.status !== 'parsing') {
      console.log(`[step-worker] Project ${projectId} has status ${project.status}, skipping`);
      return { status: 'skipped', reason: `Project status is ${project.status}` };
    }

    const errors: string[] = [];
    const parsedParts: Array<{ input: StepInputContext; part: ParsedPart }> = [];
    let totalMeshes = 0;
    let sheetMetalCount = 0;
    let totalParseMs = 0;

    for (const input of inputs) {
      console.log(`[step-worker] STEP source: ${input.stepFileRef}`);
      const stepObject = await materializeValidatedStorageObject(input.stepFileRef, 'step');
      let pdfObject: MaterializedStorageObject | null = null;

      try {
        pdfObject = input.pdfFileRef
          ? await materializeValidatedStorageObject(input.pdfFileRef, 'pdf')
          : null;
        const result = await parseStepFile(stepObject.filePath);
        totalMeshes += result.totalMeshes;
        sheetMetalCount += result.sheetMetalCount;
        totalParseMs += result.parseTimeMs;

        console.log(
          `[step-worker] Parsed ${input.sourceLabel} in ${result.parseTimeMs}ms: ${result.totalMeshes} meshes, ${result.sheetMetalCount} sheet metal`
        );

        if (!result.success) {
          throw new Error(`${input.sourceLabel}: ${result.errors.join('; ') || 'STEP parsing failed'}`);
        }

        errors.push(...result.errors.map((error) => `${input.sourceLabel}: ${error}`));
        parsedParts.push(...result.parts.map((part) => ({ input, part })));

        if (!input.isBatch && pdfObject) {
          retainedPdf = pdfObject;
          pdfObject = null;
        }
      } finally {
        await stepObject.cleanup();
        await pdfObject?.cleanup();
      }
    }

    const statusMessage = buildStatusMessage(errors, parsedParts.length, totalMeshes);

    await prisma.$transaction(async (tx) => {
      await tx.part.deleteMany({ where: { projectId } });

      for (const { input, part } of parsedParts) {
        await tx.part.create({
          data: {
            projectId,
            sourceInputId: input.isBatch ? input.sourceInputId : null,
            sourceId: input.isBatch ? input.sourceId : null,
            sourceType: input.isBatch ? input.sourceType : null,
            sourceLabel: input.isBatch ? input.sourceLabel : null,
            sourceMachineId: input.isBatch ? input.sourceMachineId ?? null : null,
            sourceMachineName: input.isBatch ? input.sourceMachineName ?? null : null,
            sourceMachineItemId: input.isBatch ? input.sourceMachineItemId ?? null : null,
            sourceProductId: input.isBatch ? input.sourceProductId ?? null : null,
            name: part.name,
            thickness: part.thickness,
            material: 'Сталь',
            width: part.width,
            height: part.height,
            bboxSizeX: part.boundingBox.sizeX,
            bboxSizeY: part.boundingBox.sizeY,
            bboxSizeZ: part.boundingBox.sizeZ,
            meshVolume: part.meshVolume,
            meshArea: part.meshArea,
            facesCount: part.facesCount,
            contour: part.contour as unknown as Prisma.InputJsonValue,
            holes: part.holes as unknown as Prisma.InputJsonValue,
            quantity: input.isBatch ? input.quantity : 1,
            isSheetMetal: part.isSheetMetal,
            grainLock: false,
            hasBends: part.hasBends,
            thumbnailSvg: part.thumbnailSvg,
            classificationMethod: part.classificationMethod,
            classificationWarning: part.classificationWarning,
          },
        });
      }

      await tx.nestingProject.update({
        where: { id: projectId },
        data: {
          status: 'parsed',
          errorMessage: statusMessage,
        },
      });
    });

    console.log(`[step-worker] Job ${job.id} completed: ${parsedParts.length} parts saved`);

    if (retainedPdf) {
      try {
        console.log('[step-worker] PDF found, analyzing with AI...');
        const aiResult = await analyzeProjectPdf({
          projectId,
          pdfFilePath: retainedPdf.filePath,
          autoApply: true,
        });

        if (aiResult.success) {
          const matchedCount = aiResult.matches.filter((match) => match.matchType !== 'none').length;
          const autoAppliedCount = aiResult.matches.filter((match) => match.autoApplied).length;
          const budgetSuffix = aiResult.budgetWarning ? ', budget warning: monthly limit exceeded' : '';
          console.log(
            `[step-worker] BOM matched: ${matchedCount}/${parsedParts.length}, auto-applied: ${autoAppliedCount}${budgetSuffix}`
          );
        } else {
          console.warn('[step-worker] AI PDF analysis failed (non-blocking):', aiResult.error);
        }
      } catch (aiError) {
        console.warn(
          '[step-worker] AI PDF analysis failed (non-blocking):',
          aiError instanceof Error ? aiError.message : aiError
        );
      }
    }

    return {
      status: 'completed',
      totalMeshes,
      sheetMetalCount,
      partsCreated: parsedParts.length,
      parseTimeMs: totalParseMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[step-worker] Job ${job.id} failed:`, message);

    await prisma.nestingProject
      .update({
        where: { id: projectId },
        data: {
          status: 'error',
          errorMessage: truncateErrorMessage(`STEP parsing error: ${message}`),
        },
      })
      .catch((dbError) => {
        console.error('[step-worker] Failed to update project status:', dbError);
      });

    throw error;
  } finally {
    await retainedPdf?.cleanup();
  }
}

async function main() {
  const boss = await getBoss();

  await boss.work<StepParsingJobData>(QUEUE_STEP_PARSING, { batchSize: 1 }, async (jobs) => {
    const results = [];

    for (const job of jobs) {
      results.push(await processStepJob(job));
    }

    return results.length === 1 ? results[0] : results;
  });

  console.log('[step-worker] Started, waiting for jobs...');

  const shutdown = async (signal: string) => {
    console.log(`[step-worker] ${signal} received, shutting down...`);
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

function buildStatusMessage(errors: string[], partsCount: number, totalMeshes: number): string | null {
  if (errors.length > 0) {
    return truncateErrorMessage(`STEP parsing completed with warnings: ${errors.join('; ')}`);
  }

  if (totalMeshes === 0) {
    return 'STEP parsing completed, but no meshes were found.';
  }

  if (partsCount === 0) {
    return 'STEP parsing completed, but no parts were extracted.';
  }

  return null;
}

function truncateErrorMessage(message: string): string {
  return message.length > 4000 ? `${message.slice(0, 3997)}...` : message;
}

main().catch((err) => {
  console.error('[step-worker] Failed to start:', err);
  process.exit(1);
});
