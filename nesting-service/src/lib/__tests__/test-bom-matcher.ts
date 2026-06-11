import assert from 'node:assert/strict';
import { matchBOMToParts } from '../ai/bom-matcher';
import type { BOMEntry, PartForMatching } from '../ai/types';

const duplicateBom: BOMEntry[] = [
  {
    position: '10',
    name: 'Plastic plug',
    material: 'Steel',
    steelTypeRaw: null,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: 2,
    thickness: null,
    notes: '',
  },
];
const duplicateParts: PartForMatching[] = [
  { id: 'plug-1', name: 'Plastic plug', material: 'Steel', steelTypeId: null, steelTypeName: null, steelTypeRaw: null, quantity: 1, thickness: 5 },
  { id: 'plug-2', name: 'Plastic plug', material: 'Steel', steelTypeId: null, steelTypeName: null, steelTypeRaw: null, quantity: 1, thickness: 5 },
];
const duplicateMatches = matchBOMToParts(duplicateBom, duplicateParts);

assert.equal(duplicateMatches.length, 2);
assert.equal(duplicateMatches[0].matchType, 'exact');
assert.equal(duplicateMatches[1].matchType, 'exact');
assert.equal(duplicateMatches[0].suggestedQuantity, null);
assert.equal(duplicateMatches[1].suggestedQuantity, null);

const singleBom: BOMEntry[] = [
  {
    position: '20',
    name: 'Side panel',
    material: 'Steel',
    steelTypeRaw: null,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: 2,
    thickness: null,
    notes: '',
  },
];
const singleParts: PartForMatching[] = [
  { id: 'panel-1', name: 'Side panel', material: 'Steel', steelTypeId: null, steelTypeName: null, steelTypeRaw: null, quantity: 1, thickness: 2 },
];
const singleMatches = matchBOMToParts(singleBom, singleParts);

assert.equal(singleMatches.length, 1);
assert.equal(singleMatches[0].matchType, 'exact');
assert.equal(singleMatches[0].suggestedQuantity, 2);

const steelBom: BOMEntry[] = [
  {
    position: '30',
    name: 'Steel panel',
    material: 'Steel',
    steelTypeRaw: 'S235',
    steelTypeId: 'steel-s235',
    steelTypeName: 'S235',
    steelTypeWarning: null,
    quantity: 1,
    thickness: null,
    notes: '',
  },
];
const steelParts: PartForMatching[] = [
  { id: 'steel-panel-1', name: 'Steel panel', material: 'Steel', steelTypeId: null, steelTypeName: null, steelTypeRaw: null, quantity: 1, thickness: 2 },
  { id: 'steel-panel-2', name: 'Steel panel', material: 'Steel', steelTypeId: null, steelTypeName: null, steelTypeRaw: null, quantity: 1, thickness: 2 },
];
const steelMatches = matchBOMToParts(steelBom, steelParts);

assert.equal(steelMatches.length, 2);
assert.equal(steelMatches[0].suggestedQuantity, null);
assert.equal(steelMatches[1].suggestedQuantity, null);
assert.equal(steelMatches[0].suggestedSteelTypeId, 'steel-s235');
assert.equal(steelMatches[1].suggestedSteelTypeName, 'S235');

console.log('[bom-matcher] all tests passed');
