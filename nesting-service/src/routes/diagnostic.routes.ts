import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../schemas/common.schema';
import { diagnosticPackageService } from '../services/diagnostic-package.service';
import { attachmentContentDisposition } from '../lib/http-headers';

export async function diagnosticRoutes(app: FastifyInstance) {
  app.get('/:id/diagnostic-package', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const result = await diagnosticPackageService.generate(id);
    logDiagnosticWarnings(request.log, id, result.warnings);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', attachmentContentDisposition(result.fileName));

    return reply.send(result.buffer);
  });
}

function logDiagnosticWarnings(
  log: { warn: (obj: Record<string, unknown>, msg: string) => void },
  projectId: string,
  warnings: string[]
): void {
  if (warnings.length > 0) {
    log.warn({ projectId, warnings }, 'Diagnostic package completed with warnings');
  }
}
