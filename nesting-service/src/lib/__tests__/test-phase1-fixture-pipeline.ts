import assert from 'node:assert/strict';
import * as path from 'node:path';
import { generateDXFWithWarnings, type DxfPartData } from '../dxf/generator';
import { polygonNetArea } from '../geometry';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingPart, SheetOption } from '../nesting/types';
import { parseStepFile, type ParsedPart } from '../step-parser';

const fixturesDir = path.join(__dirname, 'fixtures');

async function main(): Promise<void> {
  const files = [
    'plate_100x50x3_two_holes.step',
    'rounded_plate_80x80x2_r15.step',
    'l_angle_100x40x40x2.step',
  ];

  for (const file of files) {
    const parsed = await parseStepFile(path.join(fixturesDir, file));
    assert.equal(parsed.success, true, `${file} should parse`);
    assert.equal(parsed.parts.length, 1, `${file} should contain one part`);

    const part = parsed.parts[0];
    const sheet: SheetOption = {
      id: `${file}-sheet`,
      width: Math.max(part.width + 20, 200),
      height: Math.max(part.height + 20, 200),
      material: 'Сталь',
      thickness: part.thickness,
      isRemnant: false,
      priority: 1,
      potentialUtilization: 100,
    };
    const nestingPart = toNestingPart(part);
    const result = distributePartsToSheets([nestingPart], new Map([[nestingPart.id, 1]]), [sheet], {
      strategy: 'minWaste',
      gap: 0,
      margin: 0,
      grainDirection: 'horizontal',
    });

    assert.equal(result.sheets.length, 1, `${file} should produce one calculated sheet`);
    assert.equal(result.sheets[0].placements.length, 1, `${file} should place one part`);

    const placement = result.sheets[0].placements[0];
    const dxf = generateDXFWithWarnings(
      { width: sheet.width, height: sheet.height, material: sheet.material, thickness: sheet.thickness },
      [toDxfPart(part, placement)],
      null,
      { includeSheet: false, includeLabels: false, includeRemnant: false, grainArrow: false }
    );

    assert.equal(dxf.warnings.length, 0, `${file} DXF should not warn`);
    assert.match(dxf.dxfContent, /\r\n0\r\nEOF\r\n/, `${file} DXF should be complete`);

    if (file.includes('two_holes')) {
      assert.match(dxf.dxfContent, /\r\n2\r\nHOLES\r\n/, 'holes layer should be declared');
      assert.match(dxf.dxfContent, /\r\n8\r\nHOLES\r\n/, 'hole entities should be written');
      assert.match(dxf.dxfContent, /\r\n0\r\nLWPOLYLINE\r\n/, 'hole geometry should be emitted as polylines');
    }
  }
}

function toNestingPart(part: ParsedPart): NestingPart {
  return {
    id: part.name,
    name: part.name,
    width: part.width,
    height: part.height,
    contour: part.contour,
    holes: part.holes,
    grainLock: false,
    area: polygonNetArea(part.contour, part.holes),
  };
}

function toDxfPart(
  part: ParsedPart,
  placement: { x: number; y: number; rotation: DxfPartData['rotation']; placedW: number; placedH: number }
): DxfPartData {
  return {
    name: part.name,
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
    placedW: placement.placedW,
    placedH: placement.placedH,
    contour: part.contour,
    holes: part.holes,
    originalW: part.width,
    originalH: part.height,
    grainLock: false,
    contourSource: part.contourSource,
  };
}

main()
  .then(() => {
    console.log('[phase1-fixture-pipeline] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
