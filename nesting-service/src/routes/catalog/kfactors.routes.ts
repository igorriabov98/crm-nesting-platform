import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../schemas/common.schema';
import { createKFactorSchema, materialFilterSchema, updateKFactorSchema } from '../../schemas/catalog.schema';
import { catalogService } from '../../services/catalog.service';

export async function kfactorsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = materialFilterSchema.parse(request.query);
    const kFactors = await catalogService.getKFactors(query);
    return { data: kFactors };
  });

  app.post('/', async (request, reply) => {
    const data = createKFactorSchema.parse(request.body);
    const kFactor = await catalogService.createKFactor(data);
    request.log.info({ kFactorId: kFactor.id }, 'K-factor rule created');
    return reply.status(201).send({ data: kFactor });
  });

  app.put('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const data = updateKFactorSchema.parse(request.body);
    const kFactor = await catalogService.updateKFactor(id, data);
    request.log.info({ kFactorId: id }, 'K-factor rule updated');
    return { data: kFactor };
  });

  app.delete('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await catalogService.deleteKFactor(id);
    request.log.info({ kFactorId: id }, 'K-factor rule deleted');
    return { success: true };
  });
}
