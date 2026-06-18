import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test?schema=nesting';
process.env.NESTING_SERVICE_SECRET = 'test-service-secret';

async function main() {
  const { createStorageUri, parseStorageUri } = await import('../storage');
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

  assert.throws(() => parseStorageUri('supabase://product-files/private/file.step'));
  assert.throws(() => parseStorageUri('supabase://nesting-files/uploads/../secret.step'));
  assert.throws(() => parseStorageUri('supabase://unknown/products/id/file.step'));

  assert.equal(verifyServiceAuthorization(undefined), false);
  assert.equal(verifyServiceAuthorization('Bearer wrong'), false);
  assert.equal(verifyServiceAuthorization('Bearer test-service-secret'), true);

  console.log('[storage-auth] all tests passed');
}

void main();
