import assert from 'node:assert/strict';
import { CAM_DXF_OPTIONS, generateDXF, type DxfPartData } from '../dxf/generator';
import { validateDXF } from '../dxf/validate';

const parts: DxfPartData[] = [
  createRectPart('Detail A', 10, 10, 20, 10),
  createRectPart('Detail B', 50, 10, 25, 15),
];

const dxf = generateDXF(
  { width: 200, height: 100, material: 'Steel', thickness: 3 },
  parts,
  null,
  CAM_DXF_OPTIONS
);
const validation = validateDXF(dxf);

assert.equal(validation.valid, true);
assert.equal(validation.stats.blocks, 2, 'each placed part copy should be a separate BLOCK');
assert.equal(validation.stats.inserts, 2, 'each placed part copy should be placed with INSERT');
assert.equal(validation.stats.polylines, 2, 'only part contours should be closed polylines');
assert.match(dxf, /\r\n2\r\nCUT\r\n/, 'CUT layer should be declared');
assert.match(dxf, /\r\n2\r\nHOLES\r\n/, 'HOLES layer should be declared');
assert.match(dxf, /\r\n2\r\nLEAD_IN\r\n/, 'LEAD_IN layer should be declared');
assert.match(dxf, /\r\n2\r\nLEAD_OUT\r\n/, 'LEAD_OUT layer should be declared');
assert.doesNotMatch(dxf, /\r\n2\r\nSHEET\r\n/, 'CAM export should not include sheet frame layer');
assert.doesNotMatch(dxf, /\r\n2\r\nREMNANT\r\n/, 'CAM export should not include remnant layer');
assert.doesNotMatch(dxf, /LEAD_SKIPPED/, 'simple separated rectangles should receive lead-in and lead-out');

console.log('[dxf-pronest-export] all tests passed');

function createRectPart(name: string, x: number, y: number, width: number, height: number): DxfPartData {
  return {
    name,
    x,
    y,
    rotation: 0,
    placedW: width,
    placedH: height,
    originalW: width,
    originalH: height,
    grainLock: false,
    contour: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ],
    holes: [],
  };
}
