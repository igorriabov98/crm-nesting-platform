import assert from 'node:assert/strict';
import * as path from 'node:path';
import { polygonNetArea } from '../geometry';
import { parseStepFile } from '../step-parser';

const fixturesDir = path.join(__dirname, 'fixtures');

async function main(): Promise<void> {
  const holesPlate = await parseStepFile(path.join(fixturesDir, 'plate_100x50x3_two_holes.step'));
  assert.equal(holesPlate.success, true);
  assert.equal(holesPlate.parts.length, 1);
  const plate = holesPlate.parts[0];
  assert.equal(plate.contourSource, 'EXACT_BREP');
  assert.equal(plate.holes.length, 2);
  assert.equal(holesPlate.brepOk, 1);
  assert.equal(holesPlate.brepFallback, 0);
  const plateArea = polygonNetArea(plate.contour, plate.holes);
  const expectedPlateArea = 100 * 50 - 2 * Math.PI * 25;
  assert.ok(
    Math.abs(plateArea - expectedPlateArea) / expectedPlateArea < 0.01,
    `plate area ${plateArea} should be within 1% of ${expectedPlateArea}`
  );

  const roundedPlate = await parseStepFile(path.join(fixturesDir, 'rounded_plate_80x80x2_r15.step'));
  assert.equal(roundedPlate.success, true);
  assert.equal(roundedPlate.parts.length, 1);
  const rounded = roundedPlate.parts[0];
  assert.equal(rounded.contourSource, 'EXACT_BREP');
  assert.ok(rounded.contour.length > 8, 'rounded contour should include discretized arcs');
  const roundedArea = polygonNetArea(rounded.contour, rounded.holes);
  const expectedRoundedArea = 80 * 80 - 4 * (15 ** 2 - Math.PI * 15 ** 2 / 4);
  assert.ok(roundedArea < 80 * 80, 'rounded plate area should be below bbox area');
  assert.ok(
    roundedArea > expectedRoundedArea * 0.99,
    `rounded area ${roundedArea} should stay within 1% below ${expectedRoundedArea}`
  );

  const angle = await parseStepFile(path.join(fixturesDir, 'l_angle_100x40x40x2.step'));
  assert.equal(angle.success, true);
  assert.equal(angle.parts.length, 1);
  assert.notEqual(angle.parts[0].contourSource, 'EXACT_BREP');
  assert.equal(angle.brepOk, 0);
  assert.equal(angle.brepFallback, 1);
}

main()
  .then(() => {
    console.log('[brep-contour] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
