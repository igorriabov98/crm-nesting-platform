import assert from 'node:assert/strict';
import { detectFixtureTopology } from './brep-test-utils';

async function main(): Promise<void> {
  const lAngle = await detectFixtureTopology('l_angle_100x40x40_t2_r3_holes.step');
  assert.ok(lAngle, 'L-angle topology should be detected');
  assert.equal(lAngle.flanges.length, 2);
  assert.equal(lAngle.bends.length, 1);

  const uChannel = await detectFixtureTopology('u_channel_100x40x40_t2_r3.step');
  assert.ok(uChannel, 'U-channel topology should be detected');
  assert.equal(uChannel.flanges.length, 3);
  assert.equal(uChannel.bends.length, 2);

  const box = await detectFixtureTopology('box_cycle_100x40x40_t2_r3.step');
  assert.equal(box, null, 'closed bend cycle should be outside the phase2 scope');

  const flatPlate = await detectFixtureTopology('plate_100x50x3_two_holes.step');
  assert.equal(flatPlate, null, 'flat plate should not be classified as bent topology');
}

main()
  .then(() => {
    console.log('[bend-detector] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
