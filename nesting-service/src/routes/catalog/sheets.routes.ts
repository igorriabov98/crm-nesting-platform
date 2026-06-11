import type { FastifyInstance } from 'fastify';
import { idParamSchema, paginationSchema } from '../../schemas/common.schema';
import { createSheetSchema, sheetFilterSchema, updateSheetSchema } from '../../schemas/catalog.schema';
import { catalogService } from '../../services/catalog.service';

const listSheetsQuerySchema = paginationSchema.merge(sheetFilterSchema);

export async function sheetsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = listSheetsQuerySchema.parse(request.query);
    return catalogService.getSheets(query, query);
  });

  app.post('/', async (request, reply) => {
    const data = createSheetSchema.parse(request.body);
    const sheet = await catalogService.createSheet(data);
    request.log.info({ sheetId: sheet.id }, 'Sheet catalog entry saved');
    return reply.status(201).send({ data: sheet });
  });

  app.put('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateSheetSchema.parse(request.body);
    const sheet = await catalogService.updateSheet(id, data);
    request.log.info({ sheetId: id }, 'Sheet catalog entry updated');
    return { data: sheet };
  });

  app.delete('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await catalogService.deleteSheet(id);
    request.log.info({ sheetId: id }, 'Sheet catalog entry deactivated');
    return { success: true };
  });
}
