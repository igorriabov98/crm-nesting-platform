import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test?schema=nesting';
process.env.NESTING_SERVICE_SECRET = 'test-service-secret';

async function main() {
  const { createCrmFileUri, createStorageUri, parseCrmFileUri, parseStorageUri } = await import('../storage');
  const { verifyServiceAuthorization } = await import('../service-auth');

  assert.equal(
    createStorageUri('product-files', 'products/product-id/file.step'),
    'supabase://product-files/products/product-id/file.step'
  );
  assert.deepEqual(
    parseStorageUri('supabase://nesting-files/uploads/2026-06-18/id/model.step'),
    {
      bucket: 'nesting-files',
      objectPath: 'uploads/2026-06-18/id/model.step',
    }
  );
  const assetId = '019fd766-b165-7fe0-be45-760e6bf4f85c';
  assert.equal(createCrmFileUri(assetId), `crm-file://${assetId}`);
  assert.equal(parseCrmFileUri(`crm-file://${assetId}`), assetId);
  assert.throws(() => parseCrmFileUri('crm-file://not-a-uuid'));

  assert.throws(() => parseStorageUri('supabase://product-files/private/file.step'));
  assert.throws(() => parseStorageUri('supabase://nesting-files/uploads/../secret.step'));
  assert.throws(() => parseStorageUri('supabase://unknown/products/id/file.step'));

  assert.equal(verifyServiceAuthorization(undefined), false);
  assert.equal(verifyServiceAuthorization('Bearer wrong'), false);
  assert.equal(verifyServiceAuthorization('Bearer test-service-secret'), true);

  console.log('[storage-auth] all tests passed');
}

void main();
