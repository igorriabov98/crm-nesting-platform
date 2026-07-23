import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDeterministicPdfDataFromPdf } from '../ai/pdf-bom-fallback';
import { matchBOMToParts } from '../ai/bom-matcher';
import { resolveBOMSteelTypes } from '../ai/steel-types';
import type { PartForMatching, SteelTypeCatalogItem } from '../ai/types';
import { parseStepFile } from '../step-parser';
import { assertUnfoldShape } from './unfold-shape-assertions';

function assertApprox(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

async function main(): Promise<void> {
  const filePath = path.resolve(__dirname, 'fixtures/real/LEDA_024_00_000_Stol_vanna.STEP');
  const pdfPath = path.resolve(__dirname, 'fixtures/real/LEDA_024_00_000_Stol_vanna.pdf');

  if (!fs.existsSync(filePath)) {
    console.log('[leda-step-parser] skipped: LEDA STEP fixture is not present');
    return;
  }

  const result = await parseStepFile(filePath);

  assert.equal(result.success, true);
  assert.equal(result.totalMeshes, 23);
  assert.equal(result.sheetMetalCount, 21);
  assert.ok(result.parts.every((part) => !part.name.includes('Ã')));
  assert.ok(result.parts.every((part) => part.assemblyPath.length > 0), 'every parsed mesh should retain its STEP tree path');

  const angle = result.parts.find((part) => part.name === 'ЛЕДА.024.00.006 Уголок');
  assert.ok(angle);
  assert.equal(angle.isSheetMetal, true);
  assert.equal(angle.partType, 'SHEET');
  assert.equal(angle.thickness, 2);
  assert.equal(angle.classificationMethod, 'volume_area');
  assertApprox(angle.width, 1180, 0.1);
  assertApprox(angle.height, 55.97, 0.5);

  const stand = result.parts.find((part) => part.name === 'ЛЕДА.024.00.005 Стойка');
  assert.ok(stand);
  assert.equal(stand.isSheetMetal, true);
  assert.equal(stand.partType, 'SHEET');
  assertApprox(stand.width, 360, 0.1);
  assertApprox(stand.height, 55.97, 0.5);

  const topShell = result.parts.find((part) => part.name === 'ЛЕДА.024.00.001 Обшивка верхняя');
  assert.ok(topShell);
  assert.equal(topShell.isSheetMetal, true);
  assert.equal(topShell.partType, 'SHEET');
  assert.equal(topShell.thickness, 2);
  assert.equal(topShell.classificationMethod, 'volume_area');
  assertApprox(topShell.width, 1186, 0.1);
  assertApprox(topShell.height, 1172.8, 2);
  assert.equal(topShell.contourSource, 'UNFOLDED_BREP');

  const unfoldedParts = result.parts.filter((part) => part.contourSource === 'UNFOLDED_BREP');
  assert.ok(unfoldedParts.length > 0, 'LEDA should have unfolded parts for shape-invariant coverage');
  for (const part of unfoldedParts) {
    assert.ok(part.thickness && part.thickness > 0, `${part.name} should keep positive thickness`);
    assertUnfoldShape(
      { contour: part.contour, holes: part.holes },
      {
        label: `LEDA shape ${part.name}`,
        expectedArea: part.meshVolume / part.thickness,
        bomBbox: { width: part.width, height: part.height },
      }
    );
  }

  const plugRows = result.parts.filter((part) => part.name === 'Заглушка пластмассовая 15мм');
  assert.equal(plugRows.length, 2);
  assert.ok(plugRows.every((part) => !part.isSheetMetal));
  assert.ok(plugRows.every((part) => part.partType === 'PURCHASED'));
  assert.ok(plugRows.every((part) => part.thickness === 5));
  assert.ok(plugRows.every((part) => part.classificationWarning === null));
  assert.deepEqual(new Set(plugRows.map((part) => part.partType)).size, 1);
  assert.deepEqual(new Set(plugRows.map((part) => part.thickness)).size, 1);

  if (fs.existsSync(pdfPath)) {
    const steelTypes: SteelTypeCatalogItem[] = [{ id: 'steel-st3ps', name: 'Ст3пс', densityKgMm3: 0.00000785 }];
    const pdf = await extractDeterministicPdfDataFromPdf(pdfPath);
    const bom = resolveBOMSteelTypes(pdf.bom, steelTypes);
    const parts = result.parts.map(toPartForMatching);
    const matches = matchBOMToParts(bom, parts, pdf.details, steelTypes);
    const unmatched = bom.filter((entry) => !matches.some((match) =>
      match.matchType !== 'none' &&
      ((entry.designation && match.bomDesignation === entry.designation) ||
        (!entry.designation && match.bomPosition === entry.position && match.bomName === entry.name))
    ));

    assert.equal(bom.length, 10, 'LEDA BOM should have 10 deduplicated rows');
    assert.equal(unmatched.length, 0, 'LEDA should have no duplicated unmatched BOM rows');

    const positional = matches.filter((match) => match.bomDesignation.startsWith('ЛЕДА.024.00.'));
    assert.equal(positional.length, 20, 'all positional STEP details from the BOM should match by designation');
    assert.ok(positional.every((match) => match.matchType === 'designation'), 'positional details should use designation matches');

    const purchased = matches.filter((match) => match.bomName.includes('Заглушка пластмассовая'));
    assert.equal(purchased.length, 2, 'LEDA purchased plugs should match both STEP plug bodies');
    assert.ok(purchased.every((match) => match.suggestedPartType === 'PURCHASED'));

    const mismatchedSheet = matches.filter((match) =>
      match.bomDesignation === 'ЛЕДА.024.00.005' || match.bomDesignation.startsWith('ЛЕДА.024.00.006')
    );
    assert.ok(mismatchedSheet.length >= 12, 'stands and angles should be matched despite t3 vs STEP t2');
    for (const match of mismatchedSheet) {
      assert.equal(match.thicknessMismatch, true, `${match.partName} should carry a thickness mismatch flag`);
      assert.equal(match.suggestedThickness, null, `${match.partName} should keep STEP thickness`);
      assert.equal(match.suggestedSteelTypeId, 'steel-st3ps', `${match.partName} should suggest Ст3пс`);
      assert.match(match.thicknessMismatchNote ?? '', /чертёж: 3 мм/);
      assert.match(match.thicknessMismatchNote ?? '', /модель STEP: 2 мм/);
    }
  }

  console.log('[leda-step-parser] all tests passed');
}

function toPartForMatching(part: Awaited<ReturnType<typeof parseStepFile>>['parts'][number], index: number): PartForMatching {
  return {
    id: String(index),
    name: part.name,
    assemblyPath: part.assemblyPath,
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
    partType: part.partType,
    hasBends: part.hasBends,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
