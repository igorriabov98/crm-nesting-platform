import assert from 'node:assert/strict';
import path from 'node:path';
import { polygonNetArea } from '../geometry';
import { extractDeterministicPdfDataFromPdf } from '../ai/pdf-bom-fallback';
import { matchBOMToParts } from '../ai/bom-matcher';
import { parseStepFile, type ParsedPart } from '../step-parser';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingPart, SheetOption } from '../nesting/types';

async function main(): Promise<void> {
  const fixturesDir = path.resolve(__dirname, 'fixtures/real');
  const stepPath = path.join(fixturesDir, 'LEDA_024_00_000_Stol_vanna.STEP');
  const pdfPath = path.join(fixturesDir, 'LEDA_024_00_000_Stol_vanna.pdf');

  const parsed = await parseStepFile(stepPath);
  const pdfData = await extractDeterministicPdfDataFromPdf(pdfPath);
  assert.equal(parsed.success, true);

  const plugBom = pdfData.bom.find((entry) => entry.name.includes('Заглушка пластмассовая'));
  assert.ok(plugBom);
  assert.equal(plugBom.position, '19');
  assert.equal(plugBom.bomSection, 'Прочие изделия');
  assert.equal(plugBom.quantity, 2);

  const matchingParts = parsed.parts.map((part, index) => toMatchingPart(part, index));
  const matches = matchBOMToParts(pdfData.bom, matchingParts, pdfData.details);
  const plugMatches = matches.filter((match) => match.bomPosition === '19');
  assert.equal(plugMatches.length, 2);
  assert.ok(plugMatches.every((match) => match.matchType !== 'none'));
  assert.ok(plugMatches.every((match) => match.steelTypeWarning === null));
  assert.ok(plugMatches.every((match) => match.suggestedThickness === null));

  const applied = parsed.parts.map((part, index) => applyMatch(part, index, matches));
  const plugs = applied.filter((part) => part.name === 'Заглушка пластмассовая 15мм');
  assert.equal(plugs.length, 2);
  assert.ok(plugs.every((part) => part.partType === 'PURCHASED'));
  assert.ok(plugs.every((part) => part.isSheetMetal === false));
  assert.ok(plugs.every((part) => part.thickness === 5));
  assert.ok(plugs.every((part) => part.classificationWarning === null));
  assert.equal(new Set(plugs.map((part) => part.partType)).size, 1);
  assert.equal(new Set(plugs.map((part) => part.thickness)).size, 1);

  const sheetParts = applied.filter((part) => part.partType === 'SHEET');
  assert.equal(sheetParts.length, 21);
  assert.ok(sheetParts.every((part) => part.thickness !== null));

  const nestingParts = sheetParts.map((part, index) => toNestingPart(part, `sheet-${index}`));
  const quantities = new Map(nestingParts.map((part) => [part.id, 1]));
  const result = distributePartsToSheets(nestingParts, quantities, [acceptanceSheet()], {
    strategy: 'minWaste',
    gap: 1,
    margin: 1,
    grainDirection: 'horizontal',
  });

  const placed = result.placedParts;
  const profile = applied.filter((part) => part.partType === 'PROFILE').length;
  const purchased = applied.filter((part) => part.partType === 'PURCHASED').length;
  const noSheet = result.noSheetParts;
  const total = applied.length;
  assert.equal(placed, 21);
  assert.equal(profile, 0);
  assert.equal(purchased, 2);
  assert.equal(noSheet, 0);
  assert.equal(placed + profile + purchased + noSheet, total);

  const reconciliationCandidates = applied.filter((part) => part.partType === 'SHEET');
  assert.equal(reconciliationCandidates.some((part) => part.name.includes('Заглушка')), false);

  await assertStv300Regression(fixturesDir);
  await assertSkm750Regression(fixturesDir);

  console.log('[leda-purchased-acceptance] all tests passed');
}

async function assertStv300Regression(fixturesDir: string): Promise<void> {
  const parsed = await parseStepFile(path.join(fixturesDir, 'STV-300.step'));
  assert.equal(parsed.totalMeshes, 17);
  assert.equal(parsed.sheetMetalCount, 17);
  assert.equal(parsed.parts.filter((part) => part.partType === 'SHEET').length, 17);
  assert.equal(parsed.parts.filter((part) => part.partType !== 'SHEET').length, 0);
}

async function assertSkm750Regression(fixturesDir: string): Promise<void> {
  const parsed = await parseStepFile(path.join(fixturesDir, 'SKM-750.step'));
  const profileNames = parsed.parts.filter((part) => part.partType === 'PROFILE').map((part) => part.name).sort();

  assert.equal(parsed.totalMeshes, 15);
  assert.equal(parsed.sheetMetalCount, 11);
  assert.equal(parsed.parts.filter((part) => part.partType === 'SHEET').length, 11);
  assert.deepEqual(profileNames, ['achse_1', 'achse_2', 'kufe_1', 'kufe_2']);
}

function toMatchingPart(part: ParsedPart, index: number) {
  return {
    id: `part-${index}`,
    name: part.name,
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    steelTypeRaw: null,
    quantity: 1,
    thickness: part.thickness,
    width: part.width,
    height: part.height,
    bboxSizeX: part.boundingBox.sizeX,
    bboxSizeY: part.boundingBox.sizeY,
    bboxSizeZ: part.boundingBox.sizeZ,
    meshVolume: part.meshVolume,
    meshArea: part.meshArea,
    facesCount: part.facesCount,
    isSheetMetal: part.isSheetMetal,
    partType: part.partType,
    hasBends: part.hasBends,
  };
}

function applyMatch(part: ParsedPart, index: number, matches: ReturnType<typeof matchBOMToParts>): ParsedPart {
  const match = matches.find((item) => item.partId === `part-${index}`);
  const partType = match?.suggestedPartType ?? part.partType;

  return {
    ...part,
    partType,
    isSheetMetal: partType === 'SHEET',
    hasBends: partType === 'SHEET' && part.hasBends,
    classificationWarning: partType === 'SHEET' ? part.classificationWarning : null,
  };
}

function toNestingPart(part: ParsedPart, id: string): NestingPart {
  return {
    id,
    name: part.name,
    width: part.width,
    height: part.height,
    contour: part.contour,
    holes: part.holes,
    grainLock: false,
    area: Math.abs(polygonNetArea(part.contour, part.holes)) || part.width * part.height,
  };
}

function acceptanceSheet(): SheetOption {
  return {
    id: 'acceptance-sheet',
    width: 10000,
    height: 10000,
    material: 'Сталь',
    thickness: 2,
    isRemnant: false,
    priority: 1,
    potentialUtilization: 0,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
