import assert from 'node:assert/strict';
import { updatePartSchema } from '../../schemas/project.schema';

assert.equal(updatePartSchema.safeParse({ material: 'Сталь', quantity: 2 }).success, true);
assert.equal(updatePartSchema.safeParse({ width: 100 }).success, false, 'PUT schema must reject width');
assert.equal(updatePartSchema.safeParse({ height: 50 }).success, false, 'PUT schema must reject height');
assert.equal(
  updatePartSchema.safeParse({ material: 'Сталь', width: 100, height: 50 }).success,
  false,
  'PUT schema must reject any payload that tries to change dimensions'
);

console.log('[put-guard] all tests passed');
