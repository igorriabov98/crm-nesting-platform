import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { createWarningsJson, writeDxfZipFile } from '../dxf/download-archive';
import { attachmentContentDisposition, isAsciiHeaderValue } from '../http-headers';

const warnings = ['требует проверки', 'оценка развёртки'];

assert.equal(createWarningsJson([]), null);
assert.deepEqual(JSON.parse(createWarningsJson(warnings)!), { warnings });

const contentDisposition = attachmentContentDisposition('Проект оценка развёртки.zip');
assert.ok(isAsciiHeaderValue(contentDisposition), 'Content-Disposition must be ASCII-safe');
assert.match(contentDisposition, /filename="\S/);
assert.match(contentDisposition, /filename\*=UTF-8''/);
assert.match(contentDisposition, /%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82/);

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test?schema=nesting';
  const { dxfRoutes } = await import('../../routes/dxf.routes');
  const { dxfService } = await import('../../services/dxf.service');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dxf-download-warnings-'));
  const originalGenerateForSheet = dxfService.generateForSheet;
  const originalGenerateZip = dxfService.generateZip;
  let validationReport: unknown = { valid: true, violations: [], checkedAt: 'test' };
  let generateForSheetCalls = 0;
  let generateZipCalls = 0;

  try {
    const singleDxfPath = path.join(tempDir, 'single.dxf');
    writeFileSync(singleDxfPath, '0\nEOF\n', 'utf8');

    const zipPath = path.join(tempDir, 'sheets.zip');
    await writeDxfZipFile(zipPath, [{ fileName: 'sheet1.dxf', content: '0\nEOF\n' }], warnings);
    const extractedWarnings = execFileSync('unzip', ['-p', zipPath, 'warnings.json'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(extractedWarnings), { warnings });

    dxfService.generateForSheet = async () => {
      generateForSheetCalls += 1;
      return {
        filePath: singleDxfPath,
        fileName: 'Проект оценка развёртки.dxf',
        dxfContent: '0\nEOF\n',
        storageUri: null,
        warnings,
      };
    };
    dxfService.generateZip = async () => {
      generateZipCalls += 1;
      return {
        filePath: zipPath,
        fileName: 'Проект оценка развёртки.zip',
        storageUri: null,
        warnings,
      };
    };

    const app = Fastify({ logger: false });
    await app.register(dxfRoutes, {
      prefix: '/api/projects',
      loadValidationReport: async () => validationReport,
    });

    const singleResponse = await app.inject('/api/projects/project-1/dxf/sheet-1');
    assert.equal(singleResponse.statusCode, 200);
    assert.equal(singleResponse.headers['x-dxf-warnings'], undefined);
    assert.ok(isAsciiHeaderValue(String(singleResponse.headers['content-disposition'])));

    const zipResponse = await app.inject('/api/projects/project-1/dxf');
    assert.equal(zipResponse.statusCode, 200);
    assert.equal(zipResponse.headers['x-dxf-warnings'], undefined);
    assert.ok(isAsciiHeaderValue(String(zipResponse.headers['content-disposition'])));

    assert.equal(generateForSheetCalls, 1);
    assert.equal(generateZipCalls, 1);

    validationReport = {
      valid: false,
      checkedAt: 'test',
      violations: [{
        type: 'AI_ANALYSIS_FAILED',
        severity: 'error',
        partIds: [],
        message: 'AI response truncated: finish_reason=length, completion=100/100',
      }],
    };

    const blockedSingleResponse = await app.inject('/api/projects/project-1/dxf/sheet-1');
    assert.equal(blockedSingleResponse.statusCode, 400);
    assert.match(blockedSingleResponse.body, /DXF заблокирован/);
    assert.match(blockedSingleResponse.body, /finish_reason=length/);

    const blockedZipResponse = await app.inject('/api/projects/project-1/dxf');
    assert.equal(blockedZipResponse.statusCode, 400);
    assert.match(blockedZipResponse.body, /DXF заблокирован/);

    assert.equal(generateForSheetCalls, 1, 'blocked sheet DXF must not reach the generator');
    assert.equal(generateZipCalls, 1, 'blocked ZIP must not reach the generator');

    await app.close();
    console.log('[dxf-download-warnings] all tests passed');
  } finally {
    dxfService.generateForSheet = originalGenerateForSheet;
    dxfService.generateZip = originalGenerateZip;
    rmSync(tempDir, { recursive: true, force: true });
  }
}
