import assert from 'node:assert/strict';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import { DEFAULT_CUTTING_GAP_MM, DEFAULT_SHEET_MARGIN_MM, resolveNestingParams } from '../nesting/params';
import type { NestingParams, NestingPart, SheetOption } from '../nesting/types';

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const catalogParams = await resolveNestingParams(
    { material: 'Сталь', thickness: 3 },
    { getGapForMaterial: async () => 8.5 }
  );
  assert.equal(catalogParams.gap, 8.5, 'gap should come from catalog rule');
  assert.equal(catalogParams.margin, DEFAULT_SHEET_MARGIN_MM, 'margin should come from central default');

  const warnings: string[] = [];
  const fallbackParams = await resolveNestingParams(
    { material: 'Алюминий', thickness: 4 },
    {
      getGapForMaterial: async () => null,
      warn: (message) => warnings.push(message),
    }
  );
  assert.equal(fallbackParams.gap, DEFAULT_CUTTING_GAP_MM, 'missing catalog rule should use default gap');
  assert.equal(fallbackParams.margin, DEFAULT_SHEET_MARGIN_MM);
  assert.equal(warnings.length, 1, 'missing catalog rule should log one warning');
  assert.match(warnings[0], /GapTable rule not found/);

  const params: NestingParams = {
    strategy: 'minWaste',
    gap: catalogParams.gap,
    margin: catalogParams.margin,
    grainDirection: 'horizontal',
  };
  const result = distributePartsToSheets(
    [createPart('panel', 100, 80)],
    new Map([['panel', 1]]),
    [createSheet('sheet', 500, 300)],
    params
  );

  assert.equal(result.totalSheets, 1);
  assert.equal(result.sheets[0].usedGap, params.gap, 'sheet result should preserve used gap');
  assert.equal(result.sheets[0].usedMargin, params.margin, 'sheet result should preserve used margin');

  console.log('[nesting-params] all tests passed');
}

function createPart(id: string, width: number, height: number): NestingPart {
  return {
    id,
    name: id,
    width,
    height,
    contour: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: width * height,
  };
}

function createSheet(id: string, width: number, height: number): SheetOption {
  return {
    id,
    width,
    height,
    material: 'Сталь',
    thickness: 3,
    isRemnant: false,
    priority: 1,
    potentialUtilization: 20,
  };
}
