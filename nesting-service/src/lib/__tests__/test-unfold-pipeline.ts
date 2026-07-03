import assert from 'node:assert/strict';
import * as path from 'node:path';
import { generateDXFWithWarnings, type DxfPartData } from '../dxf/generator';
import { polygonNetArea } from '../geometry';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingPart, SheetOption } from '../nesting/types';
import { parseStepFile, type ParsedPart } from '../step-parser';
import { fixturesDir } from './brep-test-utils';

async function main(): Promise<void> {
  const parsed = await parseStepFile(path.join(fixturesDir, 'u_channel_100x40x40_t2_r3.step'), {
    resolveKFactor: () => ({ kFactor: 0.4, defaulted: false }),
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.parts.length, 1);
  assert.equal(parsed.brepUnfolded, 1);
  assert.equal(parsed.brepFallback, 0);
  const part = parsed.parts[0];
  assert.equal(part.contourSource, 'UNFOLDED_BREP');
  assert.ok(part.height > 120, 'unfolded contour should be developed length, not folded bbox');

  const sheet: SheetOption = {
    id: 'phase2-u-channel-sheet',
    width: 180,
    height: 180,
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

  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].placements.length, 1);
  const placement = result.sheets[0].placements[0];
  const dxf = generateDXFWithWarnings(
    { width: sheet.width, height: sheet.height, material: sheet.material, thickness: sheet.thickness },
    [toDxfPart(part, placement)],
    null,
    { includeSheet: false, includeLabels: false, includeRemnant: false, grainArrow: false }
  );

  assert.equal(dxf.warnings.length, 0);
  assert.match(dxf.dxfContent, /\r\n0\r\nLWPOLYLINE\r\n/);
  const bounds = readDxfBounds(dxf.dxfContent);
  assert.ok(bounds.maxY - bounds.minY > 120, 'DXF should contain developed U-channel contour, not folded bbox');
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

function readDxfBounds(content: string): { minY: number; maxY: number } {
  const lines = content.split(/\r?\n/);
  const ys: number[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].trim() === '20') {
      const value = Number(lines[index + 1]);
      if (Number.isFinite(value)) {
        ys.push(value);
      }
    }
  }

  return {
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

main()
  .then(() => {
    console.log('[unfold-pipeline] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
