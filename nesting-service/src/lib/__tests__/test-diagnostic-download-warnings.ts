import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { isAsciiHeaderValue } from '../http-headers';

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test?schema=nesting';
  const { diagnosticRoutes } = await import('../../routes/diagnostic.routes');
  const { diagnosticPackageService } = await import('../../services/diagnostic-package.service');
  const originalGenerate = diagnosticPackageService.generate;
  const archive = Buffer.from('diagnostic archive');

  try {
    diagnosticPackageService.generate = async () => ({
      buffer: archive,
      fileName: 'Проект оценка развёртки.zip',
      warnings: ['требует проверки', 'строка с переносом\r\nне должна попасть в заголовок'],
    });

    const app = Fastify({ logger: false });
    await app.register(diagnosticRoutes, { prefix: '/api/projects' });

    const response = await app.inject('/api/projects/project-1/diagnostic-package');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, archive);
    assert.equal(response.headers['x-diagnostic-warnings'], undefined);
    assert.ok(isAsciiHeaderValue(String(response.headers['content-disposition'])));
    assert.match(String(response.headers['content-disposition']), /filename\*=UTF-8''/);

    await app.close();
    console.log('[diagnostic-download-warnings] all tests passed');
  } finally {
    diagnosticPackageService.generate = originalGenerate;
  }
}
