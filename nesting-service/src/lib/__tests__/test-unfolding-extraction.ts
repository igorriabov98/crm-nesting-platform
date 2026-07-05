import assert from 'node:assert/strict';
import { parseDeterministicDetailText } from '../ai/pdf-bom-fallback';
import { resolveUnfolding } from '../ai/unfolding-extraction';

const bath = resolveUnfolding({
  text: 'Примечание: Развертка 1340х890 мм. Материал Лист Б-ПН-8 ГОСТ 19903-90 Ст3пс.',
  providedWidth: 19903,
  providedHeight: 90,
});
assert.equal(bath.width, 1340);
assert.equal(bath.height, 890);
assert.deepEqual(bath.warnings, []);

const rack = resolveUnfolding({
  text: 'Развёртка - 340 x 54,6 мм',
});
assert.equal(rack.width, 340);
assert.equal(rack.height, 54.6);

const gostOnly = resolveUnfolding({
  text: 'Материал: Лист Б-ПН-8 ГОСТ 19903-90 Ст3пс',
  providedWidth: 19903,
  providedHeight: 90,
});
assert.equal(gostOnly.width, null);
assert.equal(gostOnly.height, null);
assert.match(gostOnly.warnings.join('; '), /развёртка не распознана/);

const oversized = resolveUnfolding({
  providedWidth: 6000,
  providedHeight: 90,
  referenceDimsMm: [340, 100, 54.6],
});
assert.equal(oversized.width, null);
assert.equal(oversized.height, null);
assert.match(oversized.warnings.join('; '), /развёртка не распознана/);

const stampWithoutNote = resolveUnfolding({
  text: 'Масса 1,2 кг. Материал Ст3пс. ГОСТ 16523-97.',
  warnOnMissing: true,
});
assert.equal(stampWithoutNote.width, null);
assert.equal(stampWithoutNote.height, null);
assert.match(stampWithoutNote.warnings.join('; '), /развёртка не распознана/);

const groupDrawingText = `
СТВ-300.00.010-01 Уголок
Материал Лист Б-ПН-3 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97
Таблица исполнений: Исполнение Развертка
-01 1150х54,6
-02 700х54,6
-03 1080х54,6
`;
const details = parseDeterministicDetailText(groupDrawingText);

assert.equal(details.find((detail) => detail.designation === 'СТВ-300.00.010-01')?.unfoldingWidth, 1150);
assert.equal(details.find((detail) => detail.designation === 'СТВ-300.00.010-01')?.unfoldingHeight, 54.6);
assert.equal(details.find((detail) => detail.designation === 'СТВ-300.00.010-02')?.unfoldingWidth, 700);
assert.equal(details.find((detail) => detail.designation === 'СТВ-300.00.010-03')?.unfoldingWidth, 1080);

console.log('[unfolding-extraction] all tests passed');
