import assert from 'node:assert/strict';
import { applyDimensionGuard, applyThicknessGuard, isDimensionChangeSafe, isThicknessChangeSafe } from '../ai/dimension-guard';

const part = {
  name: 'Panel A',
  width: 100,
  height: 50,
};

assert.equal(isDimensionChangeSafe(part, 100.5, 50.5), true, 'roughly one percent dimension change should pass');
assert.equal(isDimensionChangeSafe(part, 105, 50), false, 'five percent area/aspect mismatch should fail');

assert.equal(
  isDimensionChangeSafe({ name: 'Ножка СТВ-300', width: 100, height: 136.2 }, 135.6, 100),
  true,
  'rotated dimensions with matching area/aspect should pass'
);
const rotatedSafe = applyDimensionGuard({}, { name: 'Ножка СТВ-300', width: 100, height: 136.2 }, 135.59, 100);
assert.equal(rotatedSafe.dimensionsApplied, true);
assert.equal(rotatedSafe.mismatch, false);
assert.equal(rotatedSafe.data.width, 100);
assert.equal(rotatedSafe.data.height, 135.59);
assert.equal(
  isDimensionChangeSafe({ name: 'Ванна СТВ-300', width: 1100, height: 650 }, 1340, 890),
  false,
  'real unfolding mismatch should still fail'
);

const blocked = applyDimensionGuard({}, part, 105, 50, { blockOnMismatch: true });
assert.equal(blocked.blocked, true, 'manual apply should block unsafe dimensions without force');
assert.match(blocked.note ?? '', /PDF предлагает 105 x 50 мм/);

const forced = applyDimensionGuard({}, part, 105, 50, { blockOnMismatch: true, force: true });
assert.equal(forced.blocked, false, 'force=true should bypass the block');
assert.equal(forced.dimensionsApplied, true);
assert.equal(forced.data.width, 105);
assert.equal(forced.data.height, 50);
assert.equal(forced.data.dimensionMismatch, false);

const safeFields = applyDimensionGuard({ material: 'Алюминий', quantity: 3 }, part, 105, 50);
assert.equal(safeFields.blocked, false, 'auto apply should keep safe fields on dimension mismatch');
assert.equal(safeFields.dimensionsApplied, false);
assert.equal(safeFields.data.material, 'Алюминий');
assert.equal(safeFields.data.quantity, 3);
assert.equal(safeFields.data.dimensionMismatch, true);
assert.match(String(safeFields.data.mismatchNote), /STEP содержит 100 x 50 мм/);

const thicknessPart = {
  name: 'Plate 4',
  thickness: 4,
};

assert.equal(isThicknessChangeSafe(thicknessPart, 4.2), true, '0.2 mm thickness change should pass');
assert.equal(isThicknessChangeSafe(thicknessPart, 3), false, '1 mm thickness mismatch should fail');

const blockedThickness = applyThicknessGuard({}, thicknessPart, 3, { blockOnMismatch: true });
assert.equal(blockedThickness.blocked, true, 'manual apply should block unsafe thickness without force');
assert.match(blockedThickness.note ?? '', /BOM предлагает толщину 3 мм/);
assert.match(blockedThickness.note ?? '', /STEP содержит 4 мм/);

const forcedThickness = applyThicknessGuard({}, thicknessPart, 3, { blockOnMismatch: true, force: true });
assert.equal(forcedThickness.blocked, false, 'force=true should bypass the thickness block');
assert.equal(forcedThickness.thicknessApplied, true);
assert.equal(forcedThickness.data.thickness, 3);
assert.equal(forcedThickness.data.thicknessMismatch, false);

const safeMaterialWithThicknessMismatch = applyThicknessGuard({ material: 'Сталь' }, thicknessPart, 3);
assert.equal(safeMaterialWithThicknessMismatch.blocked, false);
assert.equal(safeMaterialWithThicknessMismatch.thicknessApplied, false);
assert.equal(safeMaterialWithThicknessMismatch.data.material, 'Сталь');
assert.equal(safeMaterialWithThicknessMismatch.data.thicknessMismatch, true);
assert.match(String(safeMaterialWithThicknessMismatch.data.thicknessMismatchNote), /STEP содержит 4 мм/);

console.log('[dimension-guard] all tests passed');
