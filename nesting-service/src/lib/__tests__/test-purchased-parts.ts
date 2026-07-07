import assert from 'node:assert/strict';
import path from 'node:path';
import { polygonNetArea } from '../geometry';
import { extractDeterministicPdfDataFromPdf } from '../ai/pdf-bom-fallback';
import { matchBOMToParts } from '../ai/bom-matcher';
import { parseStepFile, type ParsedPart } from '../step-parser';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingPart, SheetOption } from '../nesting/types';

type AppliedPart = ParsedPart & { id: string; matchSourceSection: string | null };

const OPERATOR_PASSPORT_ROWS = [
  { label: 'ЛЕДА 024.00.007 Обшивка верхняя нижняя', match: /024\.00\.007/, width: 1186, height: 1173, thickness: 2, quantity: 1 },
  { label: 'ЛЕДА 024.00.001 Обшивка верхняя', match: /024\.00\.001/, width: 1186, height: 1173, thickness: 2, quantity: 1 },
  { label: 'ЛЕДА 024.00.008 Стенка боковая', match: /024\.00\.008/, width: 787, height: 356, thickness: 2, quantity: 2 },
  { label: 'ЛЕДА 024.00.003 Ножка-опора', match: /024\.00\.003/, width: 476, height: 100, thickness: 8, quantity: 4 },
  { label: 'ЛЕДА 024.00.005 Уголок/стойка', match: /024\.00\.005/, width: 360, height: 56, thickness: 2, quantity: 4 },
  { label: 'ЛЕДА 024.00.006-03 Уголок', match: /024\.00\.006 Уголок_-03/, width: 760, height: 56, thickness: 2, quantity: 2 },
  { label: 'ЛЕДА 024.00.006-01 Уголок', match: /024\.00\.006 Уголок_-01/, width: 725, height: 56, thickness: 2, quantity: 2 },
  { label: 'ЛЕДА 024.00.006 Уголок', match: /024\.00\.006 Уголок$/, width: 1180, height: 56, thickness: 2, quantity: 2 },
  { label: 'ЛЕДА 024.00.006-02 Уголок', match: /024\.00\.006 Уголок_-02/, width: 1126, height: 56, thickness: 2, quantity: 2 },
] as const;

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
  assert.ok(plugMatches.every((match) => match.suggestedPartType === 'PURCHASED'));
  assert.ok(plugMatches.every((match) => match.suggestedIsSheetMetal === false));
  assert.ok(plugMatches.every((match) => match.steelTypeWarning === null));
  assert.ok(plugMatches.every((match) => match.suggestedThickness === null));

  const applied = parsed.parts.map((part, index) => applyMatch(part, index, matches));
  const plugs = applied.filter((part) => part.name === 'Заглушка пластмассовая 15мм');
  assert.equal(plugs.length, 2);
  assert.ok(plugs.every((part) => part.partType === 'PURCHASED'));
  assert.ok(plugs.every((part) => part.isSheetMetal === false));
  assert.ok(plugs.every((part) => part.thickness === 5));
  assert.ok(plugs.every((part) => part.classificationWarning === null));
  assert.ok(plugs.every((part) => part.matchSourceSection === 'Прочие изделия'));
  assert.equal(new Set(plugs.map((part) => part.partType)).size, 1);
  assert.equal(new Set(plugs.map((part) => part.thickness)).size, 1);

  const sheetParts = applied.filter((part) => part.partType === 'SHEET');
  assert.equal(sheetParts.length, 21);
  assert.ok(sheetParts.every((part) => part.thickness !== null));
  assert.ok(sheetParts.every((part) => part.name !== 'Заглушка пластмассовая 15мм'));
  assertLedaAnglesAreSheet(applied);
  assertOperatorPassport(applied);

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
  assertDiagnosticSummary({ placed, profile, purchased, noSheet, total });
  assertUnknownTwentyThirdBody(applied);

  await assertStv300Regression(fixturesDir);
  await assertSkm750Regression(fixturesDir);

  console.log('[purchased-parts] all tests passed');
}

function assertLedaAnglesAreSheet(parts: AppliedPart[]): void {
  const angleGroups = [
    { suffix: 'base', match: (part: AppliedPart) => part.name === 'ЛЕДА.024.00.006 Уголок', width: 1180, quantity: 2 },
    { suffix: '-01', match: (part: AppliedPart) => part.name === 'ЛЕДА.024.00.006 Уголок_-01', width: 725, quantity: 2 },
    { suffix: '-02', match: (part: AppliedPart) => part.name === 'ЛЕДА.024.00.006 Уголок_-02', width: 1126, quantity: 2 },
    { suffix: '-03', match: (part: AppliedPart) => part.name === 'ЛЕДА.024.00.006 Уголок_-03', width: 780, quantity: 2 },
  ];

  for (const group of angleGroups) {
    const rows = parts.filter(group.match);
    assert.equal(rows.length, group.quantity, `angle ${group.suffix} quantity`);
    assert.ok(rows.every((part) => part.partType === 'SHEET'), `angle ${group.suffix} should be SHEET`);
    assert.ok(rows.every((part) => part.isSheetMetal), `angle ${group.suffix} should be sheet metal`);
    assert.ok(rows.every((part) => part.thickness === 2), `angle ${group.suffix} thickness`);
    assert.ok(rows.every((part) => withinTolerance(part.width, group.width, 0.5)), `angle ${group.suffix} width`);
    assert.ok(rows.every((part) => withinTolerance(part.height, 56, 0.5)), `angle ${group.suffix} height`);
  }
}

function assertOperatorPassport(parts: AppliedPart[]): void {
  const mismatches: string[] = [];

  for (const row of OPERATOR_PASSPORT_ROWS) {
    const matched = parts.filter((part) => row.match.test(part.name));
    assert.equal(matched.length, row.quantity, `${row.label} quantity`);
    assert.ok(matched.every((part) => part.partType === 'SHEET'), `${row.label} partType`);
    assert.ok(matched.every((part) => part.thickness === row.thickness), `${row.label} thickness`);
    for (const part of matched) {
      if (!sameUnorderedSize(part, row.width, row.height, 1)) {
        mismatches.push(`${row.label}: STEP ${round1(part.width)}x${round1(part.height)}, passport ${row.width}x${row.height}`);
      }
    }
  }

  assert.deepEqual(mismatches, [
    'ЛЕДА 024.00.006-03 Уголок: STEP 780x56, passport 760x56',
    'ЛЕДА 024.00.006-03 Уголок: STEP 780x56, passport 760x56',
  ]);
}

function assertDiagnosticSummary(summary: {
  placed: number;
  profile: number;
  purchased: number;
  noSheet: number;
  total: number;
}): void {
  assert.deepEqual(summary, {
    placed: 21,
    profile: 0,
    purchased: 2,
    noSheet: 0,
    total: 23,
  });
}

function assertUnknownTwentyThirdBody(parts: AppliedPart[]): void {
  const body = parts.find((part) => part.name === 'закрівающий уголок лидл');
  assert.ok(body);
  assert.equal(body.partType, 'SHEET');
  assert.equal(body.thickness, 2);
  assert.ok(withinTolerance(body.width, 735, 0.5));
  assert.ok(withinTolerance(body.height, 39.4, 0.5));
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

function applyMatch(part: ParsedPart, index: number, matches: ReturnType<typeof matchBOMToParts>): AppliedPart {
  const match = matches.find((item) => item.partId === `part-${index}`);
  const partType = match?.suggestedPartType ?? part.partType;

  return {
    ...part,
    id: `part-${index}`,
    partType,
    isSheetMetal: partType === 'SHEET',
    hasBends: partType === 'SHEET' && part.hasBends,
    classificationWarning: partType === 'SHEET' ? part.classificationWarning : null,
    matchSourceSection: match?.bomPosition === '19' ? 'Прочие изделия' : null,
  };
}

function toNestingPart(part: AppliedPart, id: string): NestingPart {
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

function sameUnorderedSize(part: AppliedPart, expectedWidth: number, expectedHeight: number, tolerance: number): boolean {
  return (
    withinTolerance(part.width, expectedWidth, tolerance) &&
    withinTolerance(part.height, expectedHeight, tolerance)
  ) || (
    withinTolerance(part.width, expectedHeight, tolerance) &&
    withinTolerance(part.height, expectedWidth, tolerance)
  );
}

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
