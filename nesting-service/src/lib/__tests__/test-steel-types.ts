import assert from 'node:assert/strict';
import { normalizeSteelTypeName, resolveBOMSteelTypes } from '../ai/steel-types';
import type { BOMEntry, SteelTypeCatalogItem } from '../ai/types';

const steelTypes: SteelTypeCatalogItem[] = [
  { id: 's235-id', name: 'S235', densityKgMm3: 0.00000785 },
  { id: 's235jr-id', name: 'S235JR', densityKgMm3: 0.00000785 },
  { id: 's355-id', name: 'S355', densityKgMm3: 0.00000785 },
  { id: 'hardox-id', name: 'Hardox', densityKgMm3: 0.0000078 },
  { id: 'st3ps-id', name: 'Ст3пс', densityKgMm3: 0.00000785 },
  { id: '09g2s-id', name: '09Г2С', densityKgMm3: 0.00000785 },
  { id: '20-id', name: '20', densityKgMm3: 0.00000785 },
  { id: '40x-id', name: '40Х', densityKgMm3: 0.00000785 },
  { id: '65g-id', name: '65Г', densityKgMm3: 0.00000785 },
  { id: 'aisi304-id', name: 'AISI 304', densityKgMm3: 0.00000793 },
  { id: 'aisi430-id', name: 'AISI 430', densityKgMm3: 0.0000077 },
];

const bom: BOMEntry[] = [
  createBom('Known panel', 'Сталь', 'S235'),
  createBom('Token panel', 'Сталь S355', null),
  createBom('German grade panel', 'Сталь', 'S235JRG2'),
  createBom('German material token panel', 'S235JR', null),
  createBom('Unknown panel', 'Сталь', 'S500'),
  createBom('No grade panel', 'Сталь', null),
  createBom('Low alloy panel', 'Лист 09Г2С ГОСТ 19281-2014', null),
  createBom('St3 panel', 'Лист Ст3пс ГОСТ 16523-97', null),
  createBom('Round bar', 'Сталь 20 ГОСТ 1050-2013', null),
  createBom('Alloy shaft', 'Прокат 40Х ГОСТ 4543-2016', null),
  createBom('Spring strip', 'Лента 65Г ГОСТ 14959-2016', null),
  createBom('Stainless panel', 'Лист AISI 304', null),
  createBom('Ferritic panel', 'Лист AISI 430', null),
  createBom('Latin C St3 panel', 'Лист Cт3пс ГОСТ 16523-97', null),
  createBom('Trailing St3 panel', 'Лист Ст3пс\u00A0 ГОСТ 16523-97', null),
  createBom('Exact S235JR panel', 'Сталь', 'S235JR'),
];

const resolved = resolveBOMSteelTypes(bom, steelTypes);

assert.equal(resolved[0].steelTypeId, 's235-id');
assert.equal(resolved[0].steelTypeName, 'S235');
assert.equal(resolved[0].steelTypeWarning, null);
assert.equal(resolved[1].steelTypeId, 's355-id');
assert.equal(resolved[2].steelTypeId, 's235jr-id');
assert.equal(resolved[2].steelTypeName, 'S235JR');
assert.equal(resolved[2].steelTypeRaw, 'S235JR');
assert.equal(resolved[2].steelTypeWarning, null);
assert.equal(resolved[3].steelTypeId, 's235jr-id');
assert.equal(resolved[4].steelTypeId, null);
assert.match(resolved[4].steelTypeWarning || '', /не найден/i);
assert.equal(resolved[5].steelTypeId, null);
assert.equal(resolved[5].steelTypeWarning, null);
assert.equal(resolved[6].steelTypeId, '09g2s-id');
assert.equal(resolved[6].steelTypeWarning, null);
assert.equal(resolved[7].steelTypeId, 'st3ps-id');
assert.equal(resolved[8].steelTypeId, '20-id');
assert.equal(resolved[9].steelTypeId, '40x-id');
assert.equal(resolved[10].steelTypeId, '65g-id');
assert.equal(resolved[11].steelTypeId, 'aisi304-id');
assert.equal(resolved[12].steelTypeId, 'aisi430-id');
assert.equal(resolved[13].steelTypeId, 'st3ps-id');
assert.equal(resolved[14].steelTypeId, 'st3ps-id');
assert.equal(resolved[15].steelTypeId, 's235jr-id');
assert.equal(resolved[15].steelTypeName, 'S235JR');
assert.equal(resolved[15].steelTypeWarning, null);
assert.equal(normalizeSteelTypeName('S235JRG2'), 's235');
assert.equal(normalizeSteelTypeName('S355J2'), 's355');
assert.equal(normalizeSteelTypeName('Cт3пс'), 'ст3пс');
assert.equal(normalizeSteelTypeName('Ст3пс\u00A0'), 'ст3пс');

const aliased = resolveBOMSteelTypes(
  [createBom('Aliased S235JR panel', 'Сталь', 'S235JR')],
  steelTypes.filter((steelType) => steelType.name !== 'S235JR')
);
assert.equal(aliased[0].steelTypeId, 's235-id');
assert.equal(aliased[0].steelTypeName, 'S235');
assert.match(aliased[0].steelTypeWarning || '', /алиасу/);

console.log('[steel-types] all tests passed');

function createBom(name: string, material: string, steelTypeRaw: string | null): BOMEntry {
  return {
    articleNumber: '',
    position: '',
    designation: '',
    bomSection: '',
    description: name,
    partType: 'other',
    thicknessMm: null,
    widthMm: null,
    heightMm: null,
    massKg: null,
    materialGrade: steelTypeRaw ?? '',
    materialType: 'Сталь',
    norm: '',
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
