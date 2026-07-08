import assert from 'node:assert/strict';
import { prepareBOMApplyUpdate, type BOMApplyPart } from '../ai/bom-apply';

const part = createPart({
  id: 'clean',
  name: 'Чистая строка',
  width: 100,
  height: 50,
  thickness: 2,
});

const clean = prepareBOMApplyUpdate(
  {
    partId: 'clean',
    material: 'Сталь',
    steelTypeId: 'steel-st3ps',
    steelTypeName: 'Ст3пс',
    steelTypeRaw: 'Ст3пс',
    quantity: 2,
  },
  part,
  { appliedBy: 'operator-1', appliedAt: new Date('2026-07-07T10:00:00.000Z') }
);

assert.equal(clean.status, 'updated');
if (clean.status === 'updated') {
  assert.equal(clean.update.data.quantity, 2);
  assert.equal(clean.update.data.steelTypeId, 'steel-st3ps');
  assert.ok(clean.update.data.aiApplySnapshot, 'applied row should carry rollback snapshot');
  assert.equal(clean.update.needsUnfoldRecalculation, true);
}

const purchasedQuantity = prepareBOMApplyUpdate(
  {
    partId: 'plug',
    quantity: 2,
    partType: 'PURCHASED',
  },
  createPart({
    id: 'plug',
    name: 'Заглушка пластмассовая 15мм',
    quantity: 1,
    isSheetMetal: true,
    partType: 'SHEET',
  }),
  { appliedBy: 'operator-1', appliedAt: new Date('2026-07-07T10:00:00.000Z') }
);

assert.equal(purchasedQuantity.status, 'updated');
if (purchasedQuantity.status === 'updated') {
  assert.equal('quantity' in purchasedQuantity.update.data, false, 'BOM qty must not multiply purchased STEP bodies');
  assert.equal(purchasedQuantity.update.data.partType, 'PURCHASED');
  assert.equal(purchasedQuantity.update.data.isSheetMetal, false);
}

const blocked = prepareBOMApplyUpdate(
  {
    partId: 'blocked',
    unfoldingWidth: 105,
    unfoldingHeight: 50,
  },
  createPart({
    id: 'blocked',
    name: 'Спорная ножка',
    width: 100,
    height: 50,
    thickness: 2,
  }),
  { appliedBy: 'operator-1', appliedAt: new Date('2026-07-07T10:00:00.000Z') }
);

assert.equal(blocked.status, 'blocked');
if (blocked.status === 'blocked') {
  assert.equal(blocked.blocked.reason, 'dimension_mismatch');
  assert.equal(blocked.blocked.partName, 'Спорная ножка');
  assert.equal(blocked.blocked.pdf.width, 105);
  assert.equal(blocked.blocked.pdf.height, 50);
  assert.equal(blocked.blocked.step.width, 100);
  assert.equal(blocked.blocked.step.height, 50);
  assert.equal(blocked.blocked.requiresForce, true);
  assert.match(blocked.blocked.message, /PDF предлагает 105 x 50 мм/);
  assert.match(blocked.blocked.message, /STEP содержит 100 x 50 мм/);
}

const forced = prepareBOMApplyUpdate(
  {
    partId: 'blocked',
    unfoldingWidth: 105,
    unfoldingHeight: 50,
  },
  createPart({
    id: 'blocked',
    name: 'Спорная ножка',
    width: 100,
    height: 50,
    thickness: 2,
  }),
  { force: true, appliedBy: 'operator-1', appliedAt: new Date('2026-07-07T10:00:00.000Z') }
);

assert.equal(forced.status, 'updated');
if (forced.status === 'updated') {
  assert.equal(forced.update.data.width, 105);
  assert.equal(forced.update.data.height, 50);
  assert.equal(forced.update.data.dimensionMismatch, true);
  assert.equal(forced.update.data.contourStale, true);
  assert.match(String(forced.update.data.mismatchNote), /применено принудительно/);
  assert.ok(forced.update.data.aiApplySnapshot, 'forced row should also carry rollback snapshot');
}

console.log('[bom-apply] all tests passed');

function createPart(input: Partial<BOMApplyPart> & { id: string; name: string }): BOMApplyPart {
  return {
    id: input.id,
    name: input.name,
    material: input.material ?? 'Сталь',
    steelTypeId: input.steelTypeId ?? null,
    steelTypeName: input.steelTypeName ?? null,
    steelTypeRaw: input.steelTypeRaw ?? null,
    thickness: input.thickness ?? 2,
    quantity: input.quantity ?? 1,
    width: input.width ?? 100,
    height: input.height ?? 50,
    contourStale: input.contourStale ?? false,
    isSheetMetal: input.isSheetMetal ?? true,
    partType: input.partType ?? 'SHEET',
    hasBends: input.hasBends ?? false,
    classificationMethod: input.classificationMethod ?? null,
    classificationWarning: input.classificationWarning ?? null,
  };
}
