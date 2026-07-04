import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { applyThicknessGuard } from '../ai/dimension-guard';
import { matchBOMToParts } from '../ai/bom-matcher';
import { extractDeterministicBOMFromPdf } from '../ai/pdf-bom-fallback';
import { resolveBOMSteelTypes } from '../ai/steel-types';
import type { PartForMatching, SteelTypeCatalogItem } from '../ai/types';
import { parseStepFile, type ParsedPart } from '../step-parser';

const stepPath = process.env.BOM_MULTIPLICITY_STEP ?? '/Users/igorrabov/Downloads/KVSH-100-SB-FULL.step';
const pdfPath = process.env.BOM_MULTIPLICITY_PDF ?? '/Users/igorrabov/Downloads/KVSH-100-SB-FULL.pdf';

const steelTypes: SteelTypeCatalogItem[] = [
  { id: 'steel-st3sp', name: 'Ст3сп', densityKgMm3: 0.00000785 },
  { id: 'steel-09g2s', name: '09Г2С', densityKgMm3: 0.00000785 },
];

async function main(): Promise<void> {
  assert.equal(existsSync(stepPath), true, `STEP fixture not found: ${stepPath}`);
  assert.equal(existsSync(pdfPath), true, `PDF fixture not found: ${pdfPath}`);

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

  const blockedThickness = applyThicknessGuard({}, { name: 'nakladka_1', thickness: 4 }, 3, { blockOnMismatch: true });
  assert.equal(blockedThickness.blocked, true, 'manual thickness 4 -> 3 should be blocked without force');
  assert.match(blockedThickness.note ?? '', /BOM предлагает толщину 3 мм/);
  assert.match(blockedThickness.note ?? '', /STEP содержит 4 мм/);

  const autoThickness = applyThicknessGuard({ material: 'Сталь' }, { name: 'nakladka_1', thickness: 4 }, 3);
  assert.equal(autoThickness.blocked, false, 'auto apply should keep safe fields on thickness mismatch');
  assert.equal(autoThickness.thicknessApplied, false);
  assert.equal(autoThickness.data.thicknessMismatch, true);
  assert.match(String(autoThickness.data.thicknessMismatchNote), /STEP содержит 4 мм/);

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
  console.log('[bom-multiplicity] all tests passed');
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
