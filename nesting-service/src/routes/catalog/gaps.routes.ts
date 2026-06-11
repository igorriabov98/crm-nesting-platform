import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../schemas/common.schema';
import { createGapSchema, materialFilterSchema, updateGapSchema } from '../../schemas/catalog.schema';
import { catalogService } from '../../services/catalog.service';

export async function gapsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = materialFilterSchema.parse(request.query);
    const gaps = await catalogService.getGaps(query);
    return { data: gaps };
  });

  app.post('/', async (request, reply) => {
    const data = createGapSchema.parse(request.body);
    const gap = await catalogService.createGap(data);
    request.log.info({ gapId: gap.id }, 'Gap rule created');
    return reply.status(201).send({ data: gap });
  });

  app.put('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateGapSchema.parse(request.body);
    const gap = await catalogService.updateGap(id, data);
    request.log.info({ gapId: id }, 'Gap rule updated');
    return { data: gap };
  });

  app.delete('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await catalogService.deleteGap(id);
    request.log.info({ gapId: id }, 'Gap rule deleted');
    return { success: true };
  });
}
