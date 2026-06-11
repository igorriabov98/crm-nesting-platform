import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStepFile } from '../step-parser';

function assertApprox(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

async function main(): Promise<void> {
  const filePath = path.resolve(__dirname, '../../../uploads/cmpmcbsu46f57383f93f7675b/model.step');

  if (!fs.existsSync(filePath)) {
    console.log('[leda-step-parser] skipped: LEDA STEP fixture is not present');
    return;
  }

  const result = await parseStepFile(filePath);

  assert.equal(result.success, true);
  assert.equal(result.totalMeshes, 23);
  assert.equal(result.sheetMetalCount, 15);
  assert.ok(result.parts.every((part) => !part.name.includes('Ã')));

  const angle = result.parts.find((part) => part.name === 'ЛЕДА.024.00.006 Уголок');
  assert.ok(angle);
  assert.equal(angle.isSheetMetal, true);
  assert.equal(angle.thickness, 2);
  assert.equal(angle.classificationMethod, 'volume_area');
  assertApprox(angle.width, 1180, 0.1);
  assertApprox(angle.height, 56.3, 0.5);

  const stand = result.parts.find((part) => part.name === 'ЛЕДА.024.00.005 Стойка');
  assert.ok(stand);
  assert.equal(stand.isSheetMetal, true);
  assertApprox(stand.width, 360, 0.1);
  assertApprox(stand.height, 56.3, 0.5);

  const topShell = result.parts.find((part) => part.name === 'ЛЕДА.024.00.001 Обшивка верхняя');
  assert.ok(topShell);
  assert.equal(topShell.isSheetMetal, false);
  assert.equal(topShell.thickness, 2);
  assert.equal(topShell.classificationMethod, 'volume_area');
  assertApprox(topShell.width, 1186, 0.1);
  assertApprox(topShell.height, 1173.4, 2);
  assert.match(topShell.classificationWarning ?? '', /Включите как листовую вручную/);

  const plugRows = result.parts.filter((part) => part.name === 'Заглушка пластмассовая 15мм');
  assert.equal(plugRows.length, 2);
  assert.ok(plugRows.every((part) => !part.isSheetMetal));

  console.log('[leda-step-parser] all tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
