import assert from 'node:assert/strict';
import {
  appendForceAudit,
  buildAIApplySnapshot,
  buildRestorePartData,
  hasAIApplyTrackedChange,
  hasGeometryAffectingChange,
  hasNestingAffectingChange,
  parseAIApplySnapshot,
} from '../ai/apply-control';

const stepPart = {
  material: 'Сталь',
  steelTypeId: null,
  steelTypeName: null,
  steelTypeRaw: null,
  thickness: 4,
  quantity: 1,
  width: 1100,
  height: 650,
  contourStale: false,
  isSheetMetal: true,
  partType: 'SHEET' as const,
  hasBends: false,
  classificationMethod: 'step',
  classificationWarning: null,
};

const appliedAt = new Date('2026-07-06T10:00:00.000Z');
const snapshot = buildAIApplySnapshot(stepPart, {
  appliedBy: 'operator-1',
  appliedAt,
  forced: true,
});

assert.deepEqual(snapshot, {
  ...stepPart,
  appliedBy: 'operator-1',
  appliedAt: appliedAt.toISOString(),
  forced: true,
});

assert.deepEqual(parseAIApplySnapshot(snapshot), snapshot, 'snapshot should round-trip from stored JSON');

const restoreData = buildRestorePartData(snapshot);
assert.equal(restoreData.material, 'Сталь');
assert.equal(restoreData.thickness, 4);
assert.equal(restoreData.quantity, 1);
assert.equal(restoreData.width, 1100);
assert.equal(restoreData.height, 650);
assert.equal(restoreData.contourStale, false);
assert.equal(restoreData.isSheetMetal, true);
assert.equal(restoreData.partType, 'SHEET');
assert.equal(restoreData.hasBends, false);
assert.equal(
  hasNestingAffectingChange(restoreData, stepPart),
  false,
  'reapplying identical nesting values must be idempotent'
);
assert.equal(
  hasNestingAffectingChange({ thickness: 4.29 }, stepPart),
  false,
  'thickness changes inside the 0.3 mm guard tolerance must not invalidate nesting'
);
assert.equal(
  hasNestingAffectingChange({ thickness: 4.31 }, stepPart),
  true,
  'a real thickness change must invalidate nesting'
);
assert.equal(
  hasNestingAffectingChange({ width: 1110, height: 650 }, stepPart),
  false,
  'dimension noise inside the 2% guard tolerance must be idempotent'
);
assert.equal(
  hasNestingAffectingChange({ width: 1150, height: 650 }, stepPart),
  true,
  'a real dimension change must invalidate nesting'
);
assert.equal(
  hasNestingAffectingChange({ quantity: 2 }, stepPart),
  true,
  'quantity changes must invalidate nesting'
);
assert.equal(hasGeometryAffectingChange(restoreData), true, 'restore should require recalculation for geometry fields');
assert.equal(
  hasAIApplyTrackedChange({ classificationWarning: null }, stepPart),
  false,
  'identical classification values must not create snapshots'
);
assert.equal(
  hasAIApplyTrackedChange({ classificationWarning: 'требует проверки' }, stepPart),
  true,
  'classification changes should be snapshotted'
);
assert.equal(
  hasAIApplyTrackedChange({ thumbnailSvg: '<svg />' }, stepPart),
  false,
  'untracked presentation fields should not create snapshots'
);

const audit = appendForceAudit('STEP содержит 1100 x 650 мм', 'operator-1', appliedAt);
assert.match(audit, /STEP содержит 1100 x 650 мм/);
assert.match(audit, /применено принудительно/);
assert.match(audit, /оператор operator-1/);
assert.match(audit, /2026-07-06T10:00:00.000Z/);

console.log('[ai-apply-control] all tests passed');
