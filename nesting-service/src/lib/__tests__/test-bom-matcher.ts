import assert from 'node:assert/strict';
import { matchBOMToParts } from '../ai/bom-matcher';
import { resolveBOMSteelTypes } from '../ai/steel-types';
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
    quantity: 2,
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

const exhaustedBom = [createBom({ position: '35', name: 'Single bracket', quantity: 1 })];
const exhaustedParts = [
  createPart({ id: 'single-bracket-1', name: 'Single bracket', thickness: 5 }),
  createPart({ id: 'single-bracket-2', name: 'Single bracket', thickness: 5 }),
];
const exhaustedMatches = matchBOMToParts(exhaustedBom, exhaustedParts);

assert.equal(exhaustedMatches[0].matchType, 'none');
assert.equal(exhaustedMatches[1].matchType, 'none');

const thicknessMismatchMatches = matchBOMToParts(
  [createBom({ position: '36', name: 'Wrong plate', partType: 'sheet', thicknessMm: 3, quantity: 1 })],
  [createPart({ id: 'wrong-plate', name: 'Wrong plate', thickness: 4 })]
);

assert.equal(thicknessMismatchMatches[0].matchType, 'none');
assert.match(thicknessMismatchMatches[0].matchDetails, /thickness rejected/);
assert.equal(thicknessMismatchMatches[0].suggestedThickness, null);

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
assert.equal(designationMatches[0].matchConfidence, 0.75);
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

const s235AliasMatches = matchBOMToParts(
  designationBom,
  designationParts,
  [createDetail({
    designation: 'ЛЕДА.024.00.008',
    name: 'Стенка боковая',
    materialGrade: 'S235JRG2',
    thicknessMm: 2,
  })],
  [{ id: 'steel-s235', name: 'S235', densityKgMm3: 0.00000785 }]
);

assert.equal(s235AliasMatches[0].suggestedSteelTypeId, 'steel-s235');
assert.equal(s235AliasMatches[0].suggestedSteelTypeName, 'S235');
assert.equal(s235AliasMatches[0].suggestedSteelTypeRaw, 'S235');

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
    thickness: 3,
  }),
];
const suffixMatches = matchBOMToParts(suffixBom, suffixParts, suffixDetails);

assert.equal(suffixMatches[0].matchType, 'designation');
assert.equal(suffixMatches[0].matchConfidence, 0.7);
assert.equal(suffixMatches[0].bomDesignation, 'ЛЕДА.024.00.006-01');
assert.equal(suffixMatches[0].suggestedThickness, null);
assert.equal(suffixMatches[0].suggestedUnfoldingWidth, 725);
assert.equal(suffixMatches[0].suggestedUnfoldingHeight, 55);

const prefixedDetailMatches = matchBOMToParts(
  [createBom({
    designation: 'ЭТЛ-03.001',
    description: 'Уголок гнутый s2 x 50 x 40 - 100',
    partType: 'angle',
    thicknessMm: 2,
    widthMm: 50,
    heightMm: 100,
    quantity: 6,
    massKg: 0.135,
    materialGrade: 'Ст3сп',
    steelTypeRaw: 'Ст3сп',
    steelTypeId: 'steel-st3sp',
    steelTypeName: 'Ст3сп',
  })],
  [createPart({
    id: 'etalon-03-angle',
    name: 'ci-smoke-angle',
    thickness: 2,
    width: 85.97,
    height: 100,
    bboxSizeX: 2,
    bboxSizeY: 50,
    bboxSizeZ: 100,
    meshVolume: 17197.45,
    isSheetMetal: false,
  })],
  [createDetail({
    designation: 'ЭТЛ-03.001',
    name: 'Уголок гнутый',
    materialFull: 'Ст3сп',
    materialGrade: 'Ст3сп',
    thicknessMm: 2,
    unfoldingWidth: 85.97,
    unfoldingHeight: 100,
    massKg: 0.135,
    isSheetMetal: true,
    notes: 'Развёртка 85.97 × 100',
  })],
  [{ id: 'steel-st3sp', name: 'Ст3сп', densityKgMm3: 0.00000785 }]
);

assert.equal(prefixedDetailMatches[0].matchType, 'geometry');
assert.equal(prefixedDetailMatches[0].bomDesignation, 'ЭТЛ-03.001');
assert.equal(prefixedDetailMatches[0].suggestedIsSheetMetal, true);
assert.equal(prefixedDetailMatches[0].suggestedHasBends, true);
assert.equal(prefixedDetailMatches[0].suggestedSteelTypeId, 'steel-st3sp');
assert.equal(prefixedDetailMatches[0].suggestedUnfoldingWidth, 85.97);
assert.equal(prefixedDetailMatches[0].suggestedUnfoldingHeight, 100);
assert.equal(prefixedDetailMatches[0].suggestedQuantity, 6);
assert.ok(prefixedDetailMatches[0].matchConfidence >= 0.7);

const geometryBom = [
  createBom({ description: 'BL 3 x 995 x 2318', partType: 'sheet', thicknessMm: 3, widthMm: 995, heightMm: 2318, quantity: 1, massKg: 54.41 }),
  createBom({ description: 'BL 2 x 702 x 1656', partType: 'sheet', thicknessMm: 2, widthMm: 702, heightMm: 1656, quantity: 2, massKg: 14.93 }),
  createBom({ description: 'BL 20 x 90 x 160', partType: 'sheet', thicknessMm: 20, widthMm: 90, heightMm: 160, quantity: 2, massKg: 1.7 }),
  createBom({ description: 'BL 20 x 65 x 230', partType: 'sheet', thicknessMm: 20, widthMm: 65, heightMm: 230, quantity: 4, massKg: 1.31 }),
  createBom({ description: 'BL 6 x 75 x 280', partType: 'sheet', thicknessMm: 6, widthMm: 75, heightMm: 280, quantity: 4, massKg: 1 }),
  createBom({ description: 'U 80 - 690', partType: 'channel', widthMm: 80, heightMm: 690, quantity: 4, massKg: 5.97 }),
  createBom({ description: 'U 50 x 38 - 1090', partType: 'channel', widthMm: 50, heightMm: 1090, quantity: 1, massKg: 6.09 }),
  createBom({ description: 'RU 16 - 60', partType: 'round_bar', widthMm: 16, heightMm: 60, quantity: 2, massKg: 0.095 }),
];

const geometryParts = [
  createPart({ id: 'back-wall', name: 'Задняя стенка', thickness: 3, quantity: 1, bboxSizeX: 1569, bboxSizeY: 606, bboxSizeZ: 995, isSheetMetal: true }),
  createPart({ id: 'side-wall', name: 'Боковая стенка', thickness: 2, quantity: 2, bboxSizeX: 1557, bboxSizeY: 604, bboxSizeZ: 52, isSheetMetal: true }),
  createPart({ id: 'profile-690', name: 'Профиль 690', thickness: 5.85, quantity: 4, bboxSizeX: 80, bboxSizeY: 690, bboxSizeZ: 45, isSheetMetal: false }),
  createPart({ id: 'profile-1090', name: 'Профиль 1090', thickness: 4.91, quantity: 1, bboxSizeX: 50, bboxSizeY: 60, bboxSizeZ: 1090, isSheetMetal: false }),
  createPart({ id: 'round-bar', name: 'Круг', thickness: 7.06, quantity: 2, bboxSizeX: 16, bboxSizeY: 16, bboxSizeZ: 60, isSheetMetal: false }),
  createPart({
    id: 'support',
    name: 'Опора',
    thickness: 6,
    quantity: 4,
    bboxSizeX: 75,
    bboxSizeY: 146.78,
    bboxSizeZ: 173.28,
    meshVolume: 124633.9,
    meshArea: 45967.2,
    isSheetMetal: false,
  }),
  createPart({ id: 'lower', name: 'Грушина нижняя', thickness: 20, quantity: 2, bboxSizeX: 160, bboxSizeY: 90, bboxSizeZ: 20, isSheetMetal: true }),
  createPart({ id: 'upper', name: 'Грушина верхняя', thickness: 20, quantity: 4, bboxSizeX: 20, bboxSizeY: 230, bboxSizeZ: 68, isSheetMetal: true }),
];

const geometryMatches = matchBOMToParts(geometryBom, geometryParts);
const expectedGeometryNames = [
  'BL 3 x 995 x 2318',
  'BL 2 x 702 x 1656',
  'U 80 - 690',
  'U 50 x 38 - 1090',
  'RU 16 - 60',
  'BL 6 x 75 x 280',
  'BL 20 x 90 x 160',
  'BL 20 x 65 x 230',
];

assert.equal(geometryMatches.length, expectedGeometryNames.length);
for (let index = 0; index < expectedGeometryNames.length; index += 1) {
  assert.equal(geometryMatches[index].matchType, 'geometry');
  assert.equal(geometryMatches[index].bomName, expectedGeometryNames[index]);
  assert.match(geometryMatches[index].matchDetails, /dim:|thickness:/);
}
assert.equal(geometryMatches[2].suggestedQuantity, null);
assert.equal(geometryMatches[0].suggestedUnfoldingWidth, 995);
assert.equal(geometryMatches[0].suggestedUnfoldingHeight, 2318);
assert.equal(geometryMatches[4].bomName, 'RU 16 - 60');
assert.equal(geometryMatches[4].suggestedIsSheetMetal, false);
assert.equal(geometryMatches[5].bomName, 'BL 6 x 75 x 280');
assert.equal(geometryMatches[5].suggestedIsSheetMetal, true);
assert.equal(geometryMatches[5].suggestedThickness, null);
assert.equal(geometryMatches[5].suggestedUnfoldingWidth, 75);
assert.equal(geometryMatches[5].suggestedUnfoldingHeight, 280);
assert.equal(geometryMatches[5].suggestedHasBends, true);
assert.match(geometryMatches[5].matchDetails, /mass:/);

const fallbackGeometryMatches = matchBOMToParts(
  [createBom({ description: 'U 80 - 690', partType: 'channel', widthMm: 80, heightMm: 690, quantity: 4 })],
  [createPart({ id: 'legacy-profile', name: 'Профиль старый', thickness: 5.85, width: 80, height: 690, quantity: 4, isSheetMetal: false })]
);
assert.equal(fallbackGeometryMatches[0].matchType, 'geometry');
assert.equal(fallbackGeometryMatches[0].bomName, 'U 80 - 690');

const lugBom = resolveBOMSteelTypes(
  [
    createBom({
      description: 'BL 20 x 90 x 160',
      partType: 'sheet',
      thicknessMm: 20,
      widthMm: 90,
      heightMm: 160,
      quantity: 2,
      massKg: 1.695,
      materialGrade: 'S235JRG2',
      steelTypeRaw: 'S235JRG2',
    }),
    createBom({
      description: 'BL 20 x 65 x 230',
      partType: 'sheet',
      thicknessMm: 20,
      widthMm: 65,
      heightMm: 230,
      quantity: 4,
      massKg: 1.308,
      materialGrade: 'S235JRG2',
      steelTypeRaw: 'S235JRG2',
    }),
  ],
  [{ id: 'steel-s235', name: 'S235', densityKgMm3: 0.00000785 }]
);
const lugParts = [
  createPart({ id: 'lower-1', name: 'flat body 10461 A', thickness: 20, bboxSizeX: 159.6135, bboxSizeY: 90, bboxSizeZ: 20, meshVolume: 214206.593, isSheetMetal: false }),
  createPart({ id: 'lower-2', name: 'flat body 10461 B', thickness: 20, bboxSizeX: 159.6135, bboxSizeY: 90, bboxSizeZ: 20, meshVolume: 214206.593, isSheetMetal: false }),
  createPart({ id: 'upper-1', name: 'flat body 10464 A', thickness: 20, bboxSizeX: 20, bboxSizeY: 230, bboxSizeZ: 68, meshVolume: 179436.52, isSheetMetal: false }),
  createPart({ id: 'upper-2', name: 'flat body 10464 B', thickness: 20, bboxSizeX: 20, bboxSizeY: 230, bboxSizeZ: 68, meshVolume: 179436.52, isSheetMetal: false }),
  createPart({ id: 'upper-3', name: 'flat body 10464 C', thickness: 20, bboxSizeX: 20, bboxSizeY: 230, bboxSizeZ: 68, meshVolume: 179436.52, isSheetMetal: false }),
  createPart({ id: 'upper-4', name: 'flat body 10464 D', thickness: 20, bboxSizeX: 20, bboxSizeY: 230, bboxSizeZ: 68, meshVolume: 179436.52, isSheetMetal: false }),
];
const lugMatches = matchBOMToParts(lugBom, lugParts, [], [
  { id: 'steel-s235', name: 'S235', densityKgMm3: 0.00000785 },
]);
const lugCounts = new Map<string, number>();

assert.equal(lugMatches.length, 6);
for (const match of lugMatches) {
  assert.equal(match.matchType, 'geometry');
  assert.match(match.matchDetails, /thickness:/);
  assert.match(match.matchDetails, /dim:/);
  assert.match(match.matchDetails, /mass:/);
  assert.match(match.matchDetails, /qty group:/);
  assert.equal(match.suggestedThickness, null);
  assert.equal(match.suggestedQuantity, null);
  assert.equal(match.suggestedIsSheetMetal, true);
  assert.equal(match.suggestedHasBends, false);
  assert.equal(match.suggestedSteelTypeId, 'steel-s235');
  assert.equal(match.suggestedSteelTypeName, 'S235');
  lugCounts.set(match.bomName, (lugCounts.get(match.bomName) ?? 0) + 1);
}
assert.equal(lugCounts.get('BL 20 x 90 x 160'), 2);
assert.equal(lugCounts.get('BL 20 x 65 x 230'), 4);
assert.equal(lugMatches.find((match) => match.bomName === 'BL 20 x 90 x 160')?.suggestedUnfoldingWidth, 90);
assert.equal(lugMatches.find((match) => match.bomName === 'BL 20 x 65 x 230')?.suggestedUnfoldingHeight, 230);

const sheetSortamentAngleMatches = matchBOMToParts(
  [createBom({
    designation: 'СТВ-300.00.010-01',
    name: 'Уголок',
    partType: 'angle',
    thicknessMm: 3,
    quantity: 1,
  })],
  [createPart({
    id: 'ugolok-sheet',
    name: 'СТВ-300.00.010 Уголок_-01',
    thickness: 3,
    isSheetMetal: false,
    bboxSizeX: 3,
    bboxSizeY: 54.6,
    bboxSizeZ: 1150,
  })],
  [createDetail({
    designation: 'СТВ-300.00.010-01',
    name: 'Уголок',
    materialFull: 'Лист Б-ПН-3 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97',
    thicknessMm: 3,
    unfoldingWidth: 1150,
    unfoldingHeight: 54.6,
    isSheetMetal: false,
    notes: 'Исполнение -01, развёртка 1150х54,6 мм',
  })]
);

assert.equal(sheetSortamentAngleMatches[0].matchType, 'designation');
assert.equal(sheetSortamentAngleMatches[0].suggestedIsSheetMetal, true);
assert.equal(sheetSortamentAngleMatches[0].suggestedUnfoldingWidth, 1150);
assert.equal(sheetSortamentAngleMatches[0].suggestedUnfoldingHeight, 54.6);

const wrongTwinDetailMatches = matchBOMToParts(
  [],
  [createPart({
    id: 'bordkante-1',
    name: 'bordkante_1',
    thickness: 3,
    width: 1400,
    height: 75,
    hasBends: true,
    isSheetMetal: true,
  })],
  [createDetail({
    designation: 'SKM-750.00.042',
    name: 'Bordkante',
    thicknessMm: 3,
    unfoldingWidth: 1002,
    unfoldingHeight: 344,
    isSheetMetal: true,
  })]
);
assert.equal(wrongTwinDetailMatches[0].matchType, 'none');
assert.equal(wrongTwinDetailMatches[0].matchConfidence <= 0.5, true);
assert.match(wrongTwinDetailMatches[0].matchDetails, /unfolding rejected/);

const explicitChannelMatches = matchBOMToParts(
  [createBom({ description: 'U 80 - 690', partType: 'channel', widthMm: 80, heightMm: 690, quantity: 1 })],
  [createPart({ id: 'real-channel', name: 'Швеллер 80', thickness: 5, width: 80, height: 690, isSheetMetal: true })]
);

assert.equal(explicitChannelMatches[0].suggestedIsSheetMetal, false);

console.log('[bom-matcher] all tests passed');

function createBom(input: Partial<BOMEntry>): BOMEntry {
  return {
    articleNumber: input.articleNumber ?? '',
    position: input.position ?? '',
    designation: input.designation ?? '',
    description: input.description ?? input.name ?? '',
    partType: input.partType ?? 'other',
    thicknessMm: input.thicknessMm ?? input.thickness ?? null,
    widthMm: input.widthMm ?? null,
    heightMm: input.heightMm ?? null,
    massKg: input.massKg ?? null,
    materialGrade: input.materialGrade ?? '',
    materialType: input.materialType ?? 'Сталь',
    norm: input.norm ?? '',
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
    bboxSizeX: input.bboxSizeX ?? null,
    bboxSizeY: input.bboxSizeY ?? null,
    bboxSizeZ: input.bboxSizeZ ?? null,
    meshVolume: input.meshVolume ?? null,
    meshArea: input.meshArea ?? null,
    facesCount: input.facesCount ?? null,
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
