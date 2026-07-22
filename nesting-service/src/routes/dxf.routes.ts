import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { idParamSchema } from '../schemas/common.schema';
import { projectSheetParamsSchema } from '../schemas/project.schema';
import { dxfService } from '../services/dxf.service';
import { downloadStorageBuffer } from '../lib/storage';
import { attachmentContentDisposition } from '../lib/http-headers';
import { prisma } from '../lib/prisma';
import { ValidationError } from '../lib/errors';
import { findAIAnalysisFailureMessage } from '../lib/ai/analysis-state';

type LoadProjectValidationReport = (projectId: string) => Promise<unknown>;

export type DxfRoutesOptions = {
  loadValidationReport?: LoadProjectValidationReport;
};

export async function dxfRoutes(app: FastifyInstance, options: DxfRoutesOptions = {}) {
  const loadValidationReport = options.loadValidationReport ?? loadProjectValidationReport;

  app.get('/:id/dxf', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await assertDxfIsReliable(id, loadValidationReport);
    const result = await dxfService.generateZip(id);
    logDxfWarnings(request.log, 'zip', { projectId: id }, result.warnings);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', attachmentContentDisposition(result.fileName));

    if (result.storageUri) return reply.send(await downloadStorageBuffer(result.storageUri));
    return reply.send(createReadStream(result.filePath!));
  });

  app.get('/:id/dxf/:sheetId', async (request, reply) => {
    const { id, sheetId } = projectSheetParamsSchema.parse(request.params);
    await assertDxfIsReliable(id, loadValidationReport);
    const result = await dxfService.generateForSheet(id, sheetId);
    logDxfWarnings(request.log, 'sheet', { projectId: id, sheetId }, result.warnings);

    reply.header('Content-Type', 'application/dxf');
    reply.header('Content-Disposition', attachmentContentDisposition(result.fileName));

    if (result.storageUri) return reply.send(await downloadStorageBuffer(result.storageUri));
    return reply.send(createReadStream(result.filePath!));
  });
}

async function loadProjectValidationReport(projectId: string): Promise<unknown> {
  const project = await prisma.nestingProject.findUnique({
    where: { id: projectId },
    select: { validationReport: true },
  });
  return project?.validationReport ?? null;
}

async function assertDxfIsReliable(
  projectId: string,
  loadValidationReport: LoadProjectValidationReport
): Promise<void> {
  const failure = findAIAnalysisFailureMessage(await loadValidationReport(projectId));
  if (failure) {
    throw new ValidationError(`DXF заблокирован: раскладка недостоверна. ${failure}`);
  }
}

function logDxfWarnings(
  log: { warn: (obj: Record<string, unknown>, msg: string) => void },
  exportType: 'sheet' | 'zip',
  context: Record<string, string>,
  warnings: string[]
): void {
  if (warnings.length > 0) {
    log.warn({ exportType, ...context, warnings }, 'DXF export completed with warnings');
  }
}
