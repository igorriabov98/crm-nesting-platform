import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { idParamSchema } from '../schemas/common.schema';
import { projectSheetParamsSchema } from '../schemas/project.schema';
import { dxfService } from '../services/dxf.service';
import { downloadStorageBuffer } from '../lib/storage';

export async function dxfRoutes(app: FastifyInstance) {
  app.get('/:id/dxf', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const result = await dxfService.generateZip(id);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', contentDisposition(result.fileName));
    setWarningsHeader(reply, result.warnings);

    if (result.storageUri) return reply.send(await downloadStorageBuffer(result.storageUri));
    return reply.send(createReadStream(result.filePath!));
  });

  app.get('/:id/dxf/:sheetId', async (request, reply) => {
    const { id, sheetId } = projectSheetParamsSchema.parse(request.params);
    const result = await dxfService.generateForSheet(id, sheetId);

    reply.header('Content-Type', 'application/dxf');
    reply.header('Content-Disposition', contentDisposition(result.fileName));
    setWarningsHeader(reply, result.warnings);

    if (result.storageUri) return reply.send(await downloadStorageBuffer(result.storageUri));
    return reply.send(createReadStream(result.filePath!));
  });
}

function contentDisposition(fileName: string): string {
  return `attachment; filename="${fileName.replace(/"/g, '')}"`;
}

function setWarningsHeader(reply: { header: (name: string, value: string) => unknown }, warnings: string[]): void {
  if (warnings.length > 0) {
    reply.header('X-DXF-Warnings', JSON.stringify(warnings));
  }
}
