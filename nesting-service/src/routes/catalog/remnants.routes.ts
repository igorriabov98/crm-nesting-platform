import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../schemas/common.schema';
import { createRemnantSchema, remnantFilterSchema, updateRemnantSchema } from '../../schemas/catalog.schema';
import { catalogService } from '../../services/catalog.service';

export async function remnantsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = remnantFilterSchema.parse(request.query);
    const remnants = await catalogService.getRemnants(query);
    return { data: remnants };
  });

  app.post('/', async (request, reply) => {
    const data = createRemnantSchema.parse(request.body);
    const remnant = await catalogService.createRemnant(data);
    request.log.info({ remnantId: remnant.id }, 'Remnant created');
    return reply.status(201).send({ data: remnant });
  });

  app.put('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateRemnantSchema.parse(request.body);
    const remnant = await catalogService.updateRemnant(id, data);
    request.log.info({ remnantId: id }, 'Remnant updated');
    return { data: remnant };
  });

  app.delete('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await catalogService.deleteRemnant(id);
    request.log.info({ remnantId: id }, 'Remnant deleted');
    return { success: true };
  });
}
