import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../schemas/common.schema';
import { diagnosticPackageService } from '../services/diagnostic-package.service';

export async function diagnosticRoutes(app: FastifyInstance) {
  app.get('/:id/diagnostic-package', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const result = await diagnosticPackageService.generate(id);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', contentDisposition(result.fileName));
    if (result.warnings.length > 0) {
      reply.header('X-Diagnostic-Warnings', JSON.stringify(result.warnings));
    }

    return reply.send(result.buffer);
  });
}

function contentDisposition(fileName: string): string {
  return `attachment; filename="${fileName.replace(/"/g, '')}"`;
}
