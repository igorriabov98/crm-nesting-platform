import assert from 'node:assert/strict';
import { polygonNetArea, type Point2D } from '../geometry';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingPart, SheetOption } from '../nesting/types';

const sheet: SheetOption = {
  id: 'sheet-1',
  width: 100,
  height: 100,
  material: 'Сталь',
  thickness: 3,
  isRemnant: false,
  priority: 1,
  potentialUtilization: 100,
};

const contour = rectangle(50, 50);
const hole = rectangle(20, 20, 15, 15);

const holedPart = createPart('holed', contour, [hole]);
const holedResult = distributePartsToSheets([holedPart], new Map([[holedPart.id, 1]]), [sheet], {
  strategy: 'minWaste',
  gap: 0,
  margin: 0,
  grainDirection: 'horizontal',
});

assert.equal(holedResult.sheets.length, 1);
assert.ok(
  holedResult.sheets[0].utilization < holedResult.sheets[0].bboxUtilization,
  'polygon utilization should be lower than bbox utilization for a part with holes'
);

const rectanglePart = createPart('rectangle', contour, []);
const rectangleResult = distributePartsToSheets([rectanglePart], new Map([[rectanglePart.id, 1]]), [sheet], {
  strategy: 'minWaste',
  gap: 0,
  margin: 0,
  grainDirection: 'horizontal',
});

assert.equal(rectangleResult.sheets.length, 1);
assert.equal(
  rectangleResult.sheets[0].utilization,
  rectangleResult.sheets[0].bboxUtilization,
  'polygon and bbox utilization should match for a rectangle without holes'
);

console.log('[polygon-utilization] all tests passed');

function createPart(id: string, partContour: Point2D[], holes: Point2D[][]): NestingPart {
  return {
    id,
    name: id,
    width: 50,
    height: 50,
    contour: partContour,
    holes,
    grainLock: false,
    area: polygonNetArea(partContour, holes),
  };
}

function rectangle(width: number, height: number, x = 0, y = 0): Point2D[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
}
