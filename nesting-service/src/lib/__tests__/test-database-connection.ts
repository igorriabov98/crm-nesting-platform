import assert from 'node:assert/strict';
import {
  toPgBossConnectionString,
  withPrismaConnectionLimit,
} from '../database-connection';

const source =
  'postgresql://user:pass@localhost:5432/crm?schema=nesting&connection_limit=12&sslaccept=accept_invalid_certs';

const prismaUrl = new URL(withPrismaConnectionLimit(source, 2));
assert.equal(prismaUrl.searchParams.get('schema'), 'nesting');
assert.equal(prismaUrl.searchParams.get('connection_limit'), '2');
assert.equal(prismaUrl.searchParams.get('sslaccept'), 'accept_invalid_certs');

const queueUrl = new URL(toPgBossConnectionString(source));
assert.equal(queueUrl.searchParams.get('schema'), 'nesting');
assert.equal(queueUrl.searchParams.get('connection_limit'), '12');
assert.equal(queueUrl.searchParams.has('sslaccept'), false);
assert.equal(queueUrl.searchParams.get('sslmode'), 'no-verify');

console.log('[database-connection] pool URL normalization passed');
