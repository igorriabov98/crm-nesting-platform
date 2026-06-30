import assert from 'node:assert/strict';
import { matchBOMToParts } from '../ai/bom-matcher';
import type { BOMEntry, DetailEntry, PartForMatching } from '../ai/types';

const duplicateBom = [createBom({ position: '10', name: 'Plastic plug', quantity: 2 })];
const duplicateParts = [
  createPart({ id: 'plug-1', name: 'Plastic plug', thickness: 5 }),
  createPart({ id: 'plug-2', name: 'Plastic plug', thickness: 5 }),
];
const duplicateMatches = matchBOMToParts(duplicateBom, duplicateParts);

assert.equal(duplicateMatches.length, 2);
assert.equal(duplicateMatches[0].matchType, 'exact');
assert.equal(duplicateMatches[1].matchType, 'exact');
assert.equal(duplicateMatches[0].suggestedQuantity, null);
assert.equal(duplicateMatches[1].suggestedQuantity, null);

const singleBom = [createBom({ position: '20', name: 'Side panel', quantity: 2 })];
const singleParts = [createPart({ id: 'panel-1', name: 'Side panel', thickness: 2 })];
const singleMatches = matchBOMToParts(singleBom, singleParts);

assert.equal(singleMatches.length, 1);
assert.equal(singleMatches[0].matchType, 'exact');
assert.equal(singleMatches[0].suggestedQuantity, 2);

const steelBom = [
  createBom({
    position: '30',
    name: 'Steel panel',
    steelTypeRaw: 'S235',
    steelTypeId: 'steel-s235',
    steelTypeName: 'S235',
  }),
];
const steelParts = [
  createPart({ id: 'steel-panel-1', name: 'Steel panel', thickness: 2 }),
  createPart({ id: 'steel-panel-2', name: 'Steel panel', thickness: 2 }),
];
const steelMatches = matchBOMToParts(steelBom, steelParts);

assert.equal(steelMatches.length, 2);
assert.equal(steelMatches[0].suggestedQuantity, null);
assert.equal(steelMatches[1].suggestedQuantity, null);
assert.equal(steelMatches[0].suggestedSteelTypeId, 'steel-s235');
assert.equal(steelMatches[1].suggestedSteelTypeName, 'S235');

const designationBom = [
  createBom({
    position: '8',
    designation: 'ЛЕДА.024.00.008',
    name: 'Стенка боковая',
    quantity: 2,
  }),
];
const designationDetails = [
  createDetail({
    designation: 'ЛЕДА.024.00.008',
    name: 'Стенка боковая',
    thicknessMm: 2,
    unfoldingWidth: 787,
    unfoldingHeight: 356,
  }),
];
const designationParts = [
  createPart({
    id: 'side-wall',
    name: 'ÃÃÃÃ.024.00.008 ÃÃ²Ã¥ÃíÃêÃà Ã¡Ã®ÃªÃ®Ã¢ÃàÃ¿',
    quantity: 1,
    thickness: 2,
    isSheetMetal: false,
  }),
];
const designationMatches = matchBOMToParts(designationBom, designationParts, designationDetails);

assert.equal(designationMatches[0].matchType, 'designation');
assert.equal(designationMatches[0].matchConfidence, 0.95);
assert.equal(designationMatches[0].bomDesignation, 'ЛЕДА.024.00.008');
assert.equal(designationMatches[0].suggestedUnfoldingWidth, 787);
assert.equal(designationMatches[0].suggestedUnfoldingHeight, 356);
assert.equal(designationMatches[0].suggestedIsSheetMetal, true);
assert.equal(designationMatches[0].suggestedQuantity, 2);

const resolvedGradeMatches = matchBOMToParts(designationBom, designationParts, designationDetails, [
  { id: 'steel-st3ps', name: 'Ст3пс', densityKgMm3: 0.00000785 },
]);

assert.equal(resolvedGradeMatches[0].suggestedSteelTypeId, 'steel-st3ps');
assert.equal(resolvedGradeMatches[0].suggestedSteelTypeName, 'Ст3пс');
assert.equal(resolvedGradeMatches[0].suggestedSteelTypeRaw, 'Ст3пс');

const suffixBom = [
  createBom({
    position: '6',
    designation: 'ЛЕДА.024.00.006-01',
    name: 'Уголок',
    quantity: 2,
  }),
];
const suffixDetails = [
  createDetail({
    designation: 'ЛЕДА.024.00.006-01',
    name: 'Уголок',
    thicknessMm: 3,
    unfoldingWidth: 725,
    unfoldingHeight: 55,
  }),
];
const suffixParts = [
  createPart({
    id: 'angle-01',
    name: 'ЛЕДА.024.00.006 Уголок_-01',
    thickness: 2,
  }),
];
const suffixMatches = matchBOMToParts(suffixBom, suffixParts, suffixDetails);

assert.equal(suffixMatches[0].matchType, 'designation');
assert.equal(suffixMatches[0].matchConfidence, 0.9);
assert.equal(suffixMatches[0].bomDesignation, 'ЛЕДА.024.00.006-01');
assert.equal(suffixMatches[0].suggestedThickness, 3);
assert.equal(suffixMatches[0].suggestedUnfoldingWidth, 725);
assert.equal(suffixMatches[0].suggestedUnfoldingHeight, 55);

console.log('[bom-matcher] all tests passed');

function createBom(input: Partial<BOMEntry>): BOMEntry {
  return {
    position: input.position ?? '',
    designation: input.designation ?? '',
    name: input.name ?? '',
    material: input.material ?? 'Сталь',
    steelTypeRaw: input.steelTypeRaw ?? null,
    steelTypeId: input.steelTypeId ?? null,
    steelTypeName: input.steelTypeName ?? null,
    steelTypeWarning: input.steelTypeWarning ?? null,
    quantity: input.quantity ?? 1,
    thickness: input.thickness ?? null,
    notes: input.notes ?? '',
  };
}

function createPart(input: Partial<PartForMatching> & { id: string; name: string }): PartForMatching {
  return {
    id: input.id,
    name: input.name,
    material: input.material ?? 'Сталь',
    steelTypeId: input.steelTypeId ?? null,
    steelTypeName: input.steelTypeName ?? null,
    steelTypeRaw: input.steelTypeRaw ?? null,
    quantity: input.quantity ?? 1,
    thickness: input.thickness ?? 2,
    width: input.width ?? 100,
    height: input.height ?? 100,
    isSheetMetal: input.isSheetMetal ?? true,
    hasBends: input.hasBends ?? false,
  };
}

function createDetail(input: Partial<DetailEntry> & { designation: string; name: string }): DetailEntry {
  return {
    designation: input.designation,
    name: input.name,
    materialFull: input.materialFull ?? 'Лист Б-ПН-3 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97',
    materialType: input.materialType ?? 'Сталь',
    materialGrade: input.materialGrade ?? 'Ст3пс',
    thicknessMm: input.thicknessMm ?? 3,
    unfoldingWidth: input.unfoldingWidth ?? null,
    unfoldingHeight: input.unfoldingHeight ?? null,
    massKg: input.massKg ?? null,
    isSheetMetal: input.isSheetMetal ?? true,
    notes: input.notes ?? '',
  };
}
