import type { FastifyInstance } from 'fastify';
import { aiProjectRoutes, aiRoutes } from './ai.routes';
import { calculateRoutes } from './calculate.routes';
import { dxfRoutes } from './dxf.routes';
import { healthRoutes } from './health.routes';
import { partsRoutes } from './parts.routes';
import { projectsRoutes } from './projects.routes';
import { resultRoutes } from './result.routes';
import { gapsRoutes } from './catalog/gaps.routes';
import { kfactorsRoutes } from './catalog/kfactors.routes';
import { remnantsRoutes } from './catalog/remnants.routes';
import { sheetsRoutes } from './catalog/sheets.routes';
import { uploadsRoutes } from './uploads.routes';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);

  await app.register(sheetsRoutes, { prefix: '/api/catalog/sheets' });
  await app.register(gapsRoutes, { prefix: '/api/catalog/gaps' });
  await app.register(kfactorsRoutes, { prefix: '/api/catalog/kfactors' });
  await app.register(remnantsRoutes, { prefix: '/api/catalog/remnants' });

  await app.register(aiRoutes, { prefix: '/api/ai' });
  await app.register(uploadsRoutes, { prefix: '/api/uploads' });
  await app.register(projectsRoutes, { prefix: '/api/projects' });
  await app.register(aiProjectRoutes, { prefix: '/api/projects' });
  await app.register(partsRoutes, { prefix: '/api/projects' });
  await app.register(calculateRoutes, { prefix: '/api/projects' });
  await app.register(resultRoutes, { prefix: '/api/projects' });
  await app.register(dxfRoutes, { prefix: '/api/projects' });
}
