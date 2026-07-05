import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

type Json = Record<string, unknown>;

const crmUrl = stripTrailingSlash(process.env.PROD_CRM_URL || 'https://crm-nesting-platform.vercel.app');
const nestingUrl = stripTrailingSlash(process.env.PROD_NESTING_URL || 'https://crm-nesting-platform-production.up.railway.app');
const serviceSecret = requiredEnv('NESTING_SERVICE_SECRET');
const crmCookie = requiredEnv('PROD_CRM_COOKIE');
const oldProjectId = requiredEnv('SMOKE_OLD_PROJECT_ID');
const pollAttempts = Number(process.env.SMOKE_POLL_ATTEMPTS || 60);
const pollSeconds = Number(process.env.SMOKE_POLL_SECONDS || 5);

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'prod-smoke-'));
  try {
    console.log(`[smoke] CRM=${crmUrl}`);
    console.log(`[smoke] nesting=${nestingUrl}`);

    await readJson('health', `${nestingUrl}/health`);

    const oldStatus = await readJson('old project status', serviceUrl(`/api/projects/${oldProjectId}/status`), { headers: serviceHeaders() });
    assertField(oldStatus, ['status'], 'done', 'old project status must be done');
    await readJson('old project result', serviceUrl(`/api/projects/${oldProjectId}/result`), { headers: serviceHeaders() });
    const oldDxf = await readBinary('old project dxf', serviceUrl(`/api/projects/${oldProjectId}/dxf`), { headers: serviceHeaders() });
    assert(oldDxf.status === 200, 'old project DXF must return HTTP 200');
    assertAscii(oldDxf.headers.get('content-disposition') || '', 'old project DXF Content-Disposition');

    const stepPath = materializeFixture(tempDir, 'SMOKE_ETALON03_STEP', '.step');
    const pdfPath = materializeFixture(tempDir, 'SMOKE_ETALON03_PDF', '.pdf');
    const stepStorageUri = await uploadViaUiPath('step', stepPath, '03_L_50x40.step', 'application/step');
    const pdfStorageUri = await uploadViaUiPath('pdf', pdfPath, '03_L_50x40.pdf', 'application/pdf');

    const createProject = await readJson('create project', `${crmUrl}/api/nesting/upload`, {
      method: 'POST',
      headers: crmJsonHeaders(),
      body: JSON.stringify({
        orderNumber: `${process.env.SMOKE_ORDER_PREFIX || 'ci-smoke'}-${new Date().toISOString()}`,
        quantity: 1,
        stepStorageUri,
        pdfStorageUri,
      }),
    });
    const projectId = readPath<string>(createProject, ['data', 'id']);
    assert(projectId, 'create project response must include data.id');
    console.log(`[smoke] projectId=${projectId}`);

    await waitForProjectStatus(projectId, ['parsed']);
    const analysis = await readJson('analyze', `${crmUrl}/api/nesting/ai/analyze/${projectId}`, {
      method: 'POST',
      headers: crmJsonHeaders(),
    });
    assertDetailMatch(analysis);

    await readJson('calculate', serviceUrl(`/api/projects/${projectId}/calculate`), {
      method: 'POST',
      headers: serviceJsonHeaders(),
      body: JSON.stringify({ strategy: 'minWaste' }),
    });
    await waitForProjectStatus(projectId, ['done', 'completed_with_warnings']);
    const result = await readJson('result', serviceUrl(`/api/projects/${projectId}/result`), { headers: serviceHeaders() });
    assertField(result, ['data', 'validationReport', 'valid'], true, 'validationReport.valid must be true');

    const diagnostic = await readBinary('diagnostic-package', serviceUrl(`/api/projects/${projectId}/diagnostic-package`), { headers: serviceHeaders() });
    assert(diagnostic.status === 200, 'diagnostic-package must return HTTP 200');
    const zip = await JSZip.loadAsync(diagnostic.body);
    const names = Object.keys(zip.files).sort();
    console.log(`[raw diagnostic zip entries]\n${names.join('\n')}`);
    const reconciliation = await zip.file('reconciliation.md')?.async('string');
    assert(reconciliation, 'diagnostic package must contain reconciliation.md');
    console.log(`[raw reconciliation.md]\n${reconciliation}`);
    assert(/Status \|/.test(reconciliation) && /\|\s*OK\s*\|/.test(reconciliation), 'reconciliation must contain OK row');

    console.log('[smoke] production smoke passed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function uploadViaUiPath(kind: 'step' | 'pdf', filePath: string, fileName: string, contentType: string) {
  const signed = await readJson(`signed upload ${kind}`, `${crmUrl}/api/nesting/upload-url`, {
    method: 'POST',
    headers: crmJsonHeaders(),
    body: JSON.stringify({
      kind,
      fileName,
      contentType,
      size: readFileSync(filePath).byteLength,
    }),
  });
  const data = readPath<Json>(signed, ['data']);
  const signedUrl = data?.signedUrl;
  const storageUri = data?.storageUri;
  assert(typeof signedUrl === 'string' && signedUrl.length > 0, `${kind} signedUrl is required`);
  assert(typeof storageUri === 'string' && storageUri.startsWith('supabase://'), `${kind} storageUri is required`);
  curlUpload(String(signedUrl), filePath, contentType, kind);
  return String(storageUri);
}

function curlUpload(signedUrl: string, filePath: string, contentType: string, label: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `smoke-upload-${label}-`));
  const headersPath = path.join(tempDir, 'headers.txt');
  const bodyPath = path.join(tempDir, 'body.txt');
  try {
    const result = spawnSync('curl', [
      '--http1.1',
      '-sS',
      '-D', headersPath,
      '-o', bodyPath,
      '-w', 'HTTP_STATUS:%{http_code}\\n',
      '-X', 'PUT',
      '-H', `content-type: ${contentType}`,
      '--data-binary', `@${filePath}`,
      signedUrl,
    ], { encoding: 'utf8' });
    const headers = safeRead(headersPath);
    const body = safeRead(bodyPath);
    console.log(`[raw upload ${label}]\n${result.stdout}${headers}${body}`);
    if (result.status !== 0) throw new Error(result.stderr || `curl upload ${label} failed`);
    const match = result.stdout.match(/HTTP_STATUS:(\d+)/);
    const code = match ? Number(match[1]) : 0;
    assert(code >= 200 && code < 300, `upload ${label} returned HTTP ${code}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function waitForProjectStatus(projectId: string, expected: string[]) {
  for (let i = 1; i <= pollAttempts; i += 1) {
    const payload = await readJson(`status ${projectId} #${i}`, serviceUrl(`/api/projects/${projectId}/status`), { headers: serviceHeaders() });
    const st = readPath<string>(payload, ['status']);
    if (expected.includes(String(st))) return payload;
    if (st === 'error') {
      throw new Error(`project ${projectId} failed: ${JSON.stringify(payload)}`);
    }
    await delay(pollSeconds * 1000);
  }
  throw new Error(`project ${projectId} did not reach ${expected.join('/')} after ${pollAttempts} attempts`);
}

function assertDetailMatch(payload: Json) {
  const matches = readPath<unknown[]>(payload, ['data', 'matches']) || [];
  const match = matches.find((candidate) => {
    const item = candidate as Json;
    return item.matchType === 'geometry' && String(item.matchDetails || '').startsWith('detail_geometry:');
  }) as Json | undefined;
  assert(match, 'expected geometry/detail_geometry match');
  assert(Number(match.matchConfidence) >= 0.8, 'detail_geometry confidence must be >= 0.8');
  assert(match.steelTypeWarning == null, 'steelTypeWarning must be null');
  assert(match.suggestedSteelTypeId != null, 'steelTypeId must be applied');
  assert(match.suggestedSteelTypeName === 'Ст3сп', 'steel type must be Ст3сп');
  assert(match.thicknessMismatch === false, 'thicknessMismatch must be false');
  assertClose(Number(match.suggestedUnfoldingWidth), 85.97, 0.2, 'unfolding width');
  assertClose(Number(match.suggestedUnfoldingHeight), 100, 0.2, 'unfolding height');
}

async function readJson(label: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const raw = await response.text();
  console.log(`[raw ${label}]\nHTTP ${response.status}\n${raw}`);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return parseJson(raw, label);
}

async function readBinary(label: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const body = Buffer.from(await response.arrayBuffer());
  console.log(`[raw ${label}]\nHTTP ${response.status}\n${formatHeaders(response.headers)}\nbytes=${body.length}`);
  if (!response.ok) {
    console.log(body.toString('utf8'));
  }
  return { status: response.status, headers: response.headers, body };
}

function parseJson(raw: string, label: string) {
  try {
    return JSON.parse(raw) as Json;
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

function materializeFixture(tempDir: string, prefix: string, extension: string) {
  const pathValue = process.env[`${prefix}_PATH`];
  if (pathValue) return pathValue;
  const base64 = readBase64Env(prefix);
  if (!base64) throw new Error(`${prefix}_PATH or ${prefix}_BASE64 is required`);
  const filePath = path.join(tempDir, `${prefix.toLowerCase()}${extension}`);
  writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

function readBase64Env(prefix: string) {
  const direct = process.env[`${prefix}_BASE64`];
  if (direct) return direct;

  const chunks: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const chunk = process.env[`${prefix}_BASE64_${index}`];
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join('') : null;
}

function crmJsonHeaders() {
  return {
    'Content-Type': 'application/json',
    Cookie: crmCookie,
  };
}

function serviceHeaders() {
  return { Authorization: `Bearer ${serviceSecret}` };
}

function serviceJsonHeaders() {
  return { ...serviceHeaders(), 'Content-Type': 'application/json' };
}

function serviceUrl(route: string) {
  return `${nestingUrl}${route}`;
}

function readPath<T>(value: unknown, pathParts: string[]): T | undefined {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Json)[part];
  }
  return current as T | undefined;
}

function assertField(value: unknown, pathParts: string[], expected: unknown, message: string) {
  const actual = readPath(value, pathParts);
  assert(actual === expected, `${message}: got ${String(actual)}`);
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertAscii(value: string, label: string) {
  assert(/^[\x00-\x7F]*$/.test(value), `${label} must be ASCII-safe`);
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert(Number.isFinite(actual), `${label} must be a finite number`);
  assert(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}±${tolerance}, got ${actual}`);
}

function formatHeaders(headers: Headers) {
  return Array.from(headers.entries()).map(([key, value]) => `${key}: ${value}`).join('\n');
}

function safeRead(filePath: string) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
