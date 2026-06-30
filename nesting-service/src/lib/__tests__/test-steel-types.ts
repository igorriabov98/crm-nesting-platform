import assert from 'node:assert/strict';
import { resolveBOMSteelTypes } from '../ai/steel-types';
import type { BOMEntry, SteelTypeCatalogItem } from '../ai/types';

const steelTypes: SteelTypeCatalogItem[] = [
  { id: 's235-id', name: 'S235', densityKgMm3: 0.00000785 },
  { id: 's355-id', name: 'S355', densityKgMm3: 0.00000785 },
  { id: 'hardox-id', name: 'Hardox', densityKgMm3: 0.0000078 },
];

const bom: BOMEntry[] = [
  createBom('Known panel', 'Сталь', 'S235'),
  createBom('Token panel', 'Сталь S355', null),
  createBom('Unknown panel', 'Сталь', 'S500'),
  createBom('No grade panel', 'Сталь', null),
];

const resolved = resolveBOMSteelTypes(bom, steelTypes);

assert.equal(resolved[0].steelTypeId, 's235-id');
assert.equal(resolved[0].steelTypeName, 'S235');
assert.equal(resolved[0].steelTypeWarning, null);
assert.equal(resolved[1].steelTypeId, 's355-id');
assert.equal(resolved[2].steelTypeId, null);
assert.match(resolved[2].steelTypeWarning || '', /не найден/i);
assert.equal(resolved[3].steelTypeId, null);
assert.equal(resolved[3].steelTypeWarning, null);

console.log('[steel-types] all tests passed');

function createBom(name: string, material: string, steelTypeRaw: string | null): BOMEntry {
  return {
    position: '',
    designation: '',
    name,
    material,
    steelTypeRaw,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: 1,
    thickness: null,
    notes: '',
  };
}
