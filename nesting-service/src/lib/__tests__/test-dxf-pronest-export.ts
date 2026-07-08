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
assert.equal(validation.stats.blocks, 0, 'CAM export should not hide geometry inside BLOCK definitions');
assert.equal(validation.stats.inserts, 0, 'CAM export should not rely on INSERT entities on layer 0');
assert.equal(validation.stats.polylines, 0, 'CAM export should use plain LINE entities for maximum CAM compatibility');
assert.ok(validation.stats.lines >= 8, 'part contours should be emitted as direct LINE entities');
assert.match(dxf, /\r\n2\r\nCUT\r\n/, 'CUT layer should be declared');
assert.match(dxf, /\r\n2\r\nHOLES\r\n/, 'HOLES layer should be declared');
assert.match(dxf, /\r\n2\r\nLEAD_IN\r\n/, 'LEAD_IN layer should be declared');
assert.match(dxf, /\r\n2\r\nLEAD_OUT\r\n/, 'LEAD_OUT layer should be declared');
assert.match(dxf, /\r\n8\r\nCUT\r\n/, 'CUT geometry should be present directly on the CUT layer');
assert.match(dxf, /\r\n8\r\nLEAD_IN\r\n/, 'lead-in geometry should be present directly on the LEAD_IN layer');
assert.match(dxf, /\r\n8\r\nLEAD_OUT\r\n/, 'lead-out geometry should be present directly on the LEAD_OUT layer');
assert.doesNotMatch(dxf, /\r\n0\r\nSECTION\r\n2\r\nBLOCKS\r\n/, 'CAM export should not include a BLOCKS section');
assert.doesNotMatch(dxf, /\r\n2\r\nSHEET\r\n/, 'CAM export should not include sheet frame layer');
assert.doesNotMatch(dxf, /\r\n2\r\nREMNANT\r\n/, 'CAM export should not include remnant layer');
assert.doesNotMatch(dxf, /LEAD_SKIPPED/, 'simple separated rectangles should receive lead-in and lead-out');

const shapedContour = [
  { x: 0, y: 125.969 },
  { x: 40, y: 125.969 },
  { x: 40, y: 115.969 },
  { x: 55, y: 115.969 },
  { x: 55, y: 125.969 },
  { x: 80, y: 125.969 },
  { x: 100, y: 105.969 },
  { x: 100, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 125.969 },
];
const shapedDxf = generateDXF(
  { width: 300, height: 200, material: 'Steel', thickness: 2 },
  [{
    name: 'Shaped flange',
    x: 0,
    y: 0,
    rotation: 0,
    placedW: 100,
    placedH: 125.969,
    originalW: 100,
    originalH: 125.969,
    grainLock: false,
    contour: shapedContour,
    holes: [],
  }],
  null,
  {
    entityMode: 'lwpolyline',
    includeSheet: false,
    includeLabels: false,
    includeRemnant: false,
    grainArrow: false,
    leadInLength: 0,
    leadOutLength: 0,
  }
);
assert.match(shapedDxf, /\r\n90\r\n9\r\n/, 'shaped cut contour should keep nine DXF vertices, not collapse to a rectangle');
assert.match(shapedDxf, /\r\n10\r\n40\r\n20\r\n115\.969\r\n/, 'DXF should contain notch bottom-left vertex');
assert.match(shapedDxf, /\r\n10\r\n55\r\n20\r\n115\.969\r\n/, 'DXF should contain notch bottom-right vertex');
assert.match(shapedDxf, /\r\n10\r\n100\r\n20\r\n105\.969\r\n/, 'DXF should contain chamfer side vertex');

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
