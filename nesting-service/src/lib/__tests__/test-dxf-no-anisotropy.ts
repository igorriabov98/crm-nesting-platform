import assert from 'node:assert/strict';
import { CAM_DXF_OPTIONS, generateDXFWithWarnings, type DxfPartData } from '../dxf/generator';
import { readFittedPartGeometry } from '../dxf/part-geometry';

const sourceContour = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
  { x: 0, y: 0 },
];

const anisotropic = readFittedPartGeometry(sourceContour, [], 150, 100);
assert.equal(anisotropic.needsReview, true, 'anisotropic scale must require review');

const reviewDxf = generateDXFWithWarnings(
  { width: 300, height: 200, material: 'Steel', thickness: 3 },
  [createPart('Mismatch', anisotropic)],
  null,
  CAM_DXF_OPTIONS
);

assert.ok(reviewDxf.warnings.some((warning) => warning.includes('Mismatch')), 'review part should be listed in warnings');
assert.match(reviewDxf.dxfContent, /\r\n2\r\nNEEDS_REVIEW\r\n/, 'NEEDS_REVIEW layer should be declared');
assert.match(reviewDxf.dxfContent, /\r\n8\r\nNEEDS_REVIEW\r\n/, 'review rectangle should be emitted on NEEDS_REVIEW');
assert.doesNotMatch(reviewDxf.dxfContent, /Mismatch ESTIMATE/, 'anisotropy alone should not masquerade as an estimate label');

const almostUniform = readFittedPartGeometry(sourceContour, [], 100.2, 100);
assert.equal(almostUniform.needsReview, false, 'small rounding-scale mismatch should pass');

const rotatedUniform = readFittedPartGeometry(
  [
    { x: 0, y: 0 },
    { x: 136.2, y: 0 },
    { x: 136.2, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 0 },
  ],
  [],
  100,
  135.59
);
assert.equal(rotatedUniform.needsReview, false, '90 degree contour orientation should pass when uniform after rotation');

const stale = readFittedPartGeometry(sourceContour, [], 1340, 890, { contourStale: true });
assert.equal(stale.needsReview, true, 'stale contour must require review');
assert.match(stale.reviewReason || '', /контур не соответствует/);

const normalDxf = generateDXFWithWarnings(
  { width: 300, height: 200, material: 'Steel', thickness: 3 },
  [createPart('Uniform', almostUniform)],
  null,
  CAM_DXF_OPTIONS
);
assert.equal(normalDxf.warnings.length, 0, 'uniform scale in tolerance should not warn');
assert.match(normalDxf.dxfContent, /\r\n8\r\nCUT\r\n/, 'accepted geometry should remain on CUT');

console.log('[dxf-no-anisotropy] all tests passed');

function createPart(
  name: string,
  geometry: { contour: DxfPartData['contour']; holes: DxfPartData['holes']; needsReview: boolean; reviewReason: string | null }
): DxfPartData {
  return {
    name,
    x: 10,
    y: 10,
    rotation: 0,
    placedW: 150,
    placedH: 100,
    contour: geometry.contour,
    holes: geometry.holes,
    originalW: 150,
    originalH: 100,
    grainLock: false,
    needsReview: geometry.needsReview,
    reviewReason: geometry.reviewReason,
  };
}
