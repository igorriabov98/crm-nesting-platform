import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { applyThicknessGuard } from '../ai/dimension-guard';
import { matchBOMToParts } from '../ai/bom-matcher';
import { extractDeterministicBOMFromPdf } from '../ai/pdf-bom-fallback';
import { resolveBOMSteelTypes } from '../ai/steel-types';
import type { DetailEntry, PartForMatching, SteelTypeCatalogItem } from '../ai/types';
import { parseStepFile, type ParsedPart } from '../step-parser';

const stepPath = process.env.BOM_MULTIPLICITY_STEP ?? '/Users/igorrabov/Downloads/KVSH-100-SB-FULL.step';
const pdfPath = process.env.BOM_MULTIPLICITY_PDF ?? '/Users/igorrabov/Downloads/KVSH-100-SB-FULL.pdf';

const steelTypes: SteelTypeCatalogItem[] = [
  { id: 'steel-st3sp', name: 'Ст3сп', densityKgMm3: 0.00000785 },
  { id: 'steel-09g2s', name: '09Г2С', densityKgMm3: 0.00000785 },
];

async function main(): Promise<void> {
  if (existsSync(stepPath) && existsSync(pdfPath)) {
    await assertKvshAssemblyFixture();
  } else {
    console.log(`[bom-multiplicity] skipped KVSH fixture section: STEP/PDF not found (${stepPath}, ${pdfPath})`);
  }

  const blockedThickness = applyThicknessGuard({}, { name: 'nakladka_1', thickness: 4 }, 3, { blockOnMismatch: true });
  assert.equal(blockedThickness.blocked, true, 'manual thickness 4 -> 3 should be blocked without force');
  assert.match(blockedThickness.note ?? '', /BOM предлагает толщину 3 мм/);
  assert.match(blockedThickness.note ?? '', /STEP содержит 4 мм/);

  const autoThickness = applyThicknessGuard({ material: 'Сталь' }, { name: 'nakladka_1', thickness: 4 }, 3);
  assert.equal(autoThickness.blocked, false, 'auto apply should keep safe fields on thickness mismatch');
  assert.equal(autoThickness.thicknessApplied, false);
  assert.equal(autoThickness.data.thicknessMismatch, true);
  assert.match(String(autoThickness.data.thicknessMismatchNote), /STEP содержит 4 мм/);

  const detailOnlyPart = createEtalon03Part({ thickness: 2 });
  const detailOnlyMatches = matchBOMToParts([], [detailOnlyPart], [createEtalon03Detail()], steelTypes);
  assert.equal(detailOnlyMatches.length, 1, 'detail-only PDF should produce one match result');
  const detailOnlyMatch = detailOnlyMatches[0];
  assert.equal(detailOnlyMatch.matchType, 'geometry', 'detail-only PDF should match by geometry');
  assert.equal(detailOnlyMatch.matchConfidence >= 0.8, true, 'detail-only geometry should be auto-apply eligible');
  assert.match(detailOnlyMatch.matchDetails, /^detail_geometry:/);
  assert.equal(detailOnlyMatch.bomName, 'Уголок гнутый');
  assert.equal(detailOnlyMatch.bomDesignation, 'ЭТЛ-03.001');
  assert.equal(detailOnlyMatch.suggestedMaterialGrade, 'Ст3сп');
  assert.equal(detailOnlyMatch.suggestedSteelTypeId, 'steel-st3sp');
  assert.equal(detailOnlyMatch.suggestedSteelTypeName, 'Ст3сп');
  assert.equal(detailOnlyMatch.suggestedThickness, null, 'matching s2 detail should not rewrite an s2 STEP part');
  assert.equal(detailOnlyMatch.suggestedUnfoldingWidth, 85.97);
  assert.equal(detailOnlyMatch.suggestedUnfoldingHeight, 100);
  assert.equal(detailOnlyMatch.suggestedQuantity, null, 'detail notes quantity should not be applied');

  const mismatchedDetailMatches = matchBOMToParts([], [createEtalon03Part({ thickness: 4 })], [createEtalon03Detail()], steelTypes);
  assert.equal(mismatchedDetailMatches[0].matchType, 'none', 'detail s2 must not match STEP thickness s4');
  assert.equal(mismatchedDetailMatches[0].matchConfidence, 0);
  assert.equal(mismatchedDetailMatches[0].suggestedSteelTypeId, null);

  console.log('[bom-multiplicity] all tests passed');
}

async function assertKvshAssemblyFixture(): Promise<void> {
  const parsed = await parseStepFile(stepPath);
  assert.equal(parsed.success, true, 'STEP should parse');
  assert.equal(parsed.parts.length, 10, 'STEP assembly should contain 10 bodies');

  const rawBom = await extractDeterministicBOMFromPdf(pdfPath);
  const bom = resolveBOMSteelTypes(rawBom, steelTypes);
  assert.equal(bom.length, 5, 'PDF BOM should contain 5 rows');

  const parts = parsed.parts.map(toPartForMatching);
  const matches = matchBOMToParts(bom, parts, [], steelTypes);
  assert.equal(matches.length, 10, 'all STEP bodies should produce match results');

  const expectedPositions = new Map<string, string>([
    ['obechayka', '1'],
    ['bokovina_1', '2'],
    ['bokovina_2', '2'],
    ['kozyrek', '3'],
    ['nakladka_1', '4'],
    ['nakladka_2', '4'],
    ['kronshteyn_1', '5'],
    ['kronshteyn_2', '5'],
    ['kronshteyn_3', '5'],
    ['kronshteyn_4', '5'],
  ]);

  for (const match of matches) {
    assert.equal(match.matchType === 'none', false, `${match.partName} should be matched`);
    assert.equal(match.bomPosition, expectedPositions.get(match.partName), `${match.partName} should match its own BOM position`);
    assert.equal(match.matchConfidence >= 0.8, true, `${match.partName} should be auto-apply eligible`);
    assert.equal(match.suggestedQuantity, null, `${match.partName} should keep per-body quantity=1`);
  }

  const unmatchedBom = bom.filter((entry) => !matches.some((match) => match.bomPosition === entry.position));
  assert.equal(unmatchedBom.length, 0, 'there should be no BOM rows without STEP bodies');

  const countsByPosition = countMatchesByPosition(matches);
  for (const entry of bom) {
    assert.equal(countsByPosition.get(entry.position), entry.quantity, `BOM position ${entry.position} quantity should equal matched group size`);
  }

  const nakladki = matches.filter((match) => match.bomPosition === '4');
  assert.equal(nakladki.length, 2, 'position 4 should match two nakladka bodies');
  for (const match of nakladki) {
    const part = parts.find((candidate) => candidate.id === match.partId);
    assert.equal(part?.thickness, 4, `${match.partName} STEP thickness should remain 4 mm`);
    assert.equal(match.suggestedThickness, null, `${match.partName} should not suggest 4 -> other thickness`);
    assert.equal(match.suggestedSteelTypeId, 'steel-09g2s', `${match.partName} should resolve 09Г2С`);
    assert.equal(match.suggestedSteelTypeName, '09Г2С');
  }

  console.table(
    bom.map((entry) => {
      const rowMatches = matches.filter((match) => match.bomPosition === entry.position);
      return {
        position: entry.position,
        parts: rowMatches.map((match) => match.partName).join(', '),
        confidence: rowMatches.map((match) => `${Math.round(match.matchConfidence * 100)}%`).join(', '),
      };
    })
  );
}

function toPartForMatching(part: ParsedPart, index: number): PartForMatching {
  return {
    id: `${index}`,
    name: part.name,
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    steelTypeRaw: null,
    quantity: 1,
    thickness: part.thickness ?? 0,
    width: part.width,
    height: part.height,
    bboxSizeX: part.boundingBox.sizeX,
    bboxSizeY: part.boundingBox.sizeY,
    bboxSizeZ: part.boundingBox.sizeZ,
    contour: part.contour,
    meshVolume: part.meshVolume,
    meshArea: part.meshArea,
    facesCount: part.facesCount,
    isSheetMetal: part.isSheetMetal,
    hasBends: part.hasBends,
  };
}

function createEtalon03Part(input: { thickness: number }): PartForMatching {
  return {
    id: `etalon-03-s${input.thickness}`,
    name: 'Open CASCADE STEP translator 7.9 3',
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    steelTypeRaw: null,
    quantity: 1,
    thickness: input.thickness,
    width: 100,
    height: 85.81,
    bboxSizeX: 50,
    bboxSizeY: 40,
    bboxSizeZ: 100,
    meshVolume: 17246.11723639627,
    meshArea: 17998.9244799379,
    facesCount: 76,
    isSheetMetal: true,
    hasBends: true,
  };
}

function createEtalon03Detail(): DetailEntry {
  return {
    designation: 'ЭТЛ-03.001',
    name: 'Уголок гнутый',
    materialFull: 'Ст3сп',
    materialType: 'Сталь',
    materialGrade: 'Ст3сп',
    thicknessMm: 2,
    unfoldingWidth: 85.97,
    unfoldingHeight: 100,
    massKg: 0.135,
    isSheetMetal: true,
    notes: 'Кол-во: 6 шт.; Внутр. радиус гиба R3, угол 90°',
  };
}

function countMatchesByPosition(matches: Array<{ bomPosition: string; matchType: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (match.matchType === 'none') continue;
    counts.set(match.bomPosition, (counts.get(match.bomPosition) ?? 0) + 1);
  }
  return counts;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
