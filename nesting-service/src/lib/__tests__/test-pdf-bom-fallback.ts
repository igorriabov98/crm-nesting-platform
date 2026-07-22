import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  extractDeterministicBOMFromPdf,
  extractDeterministicPdfDataFromPdf,
  mergeDeterministicBOM,
  parseDeterministicBOMPages,
  parseDeterministicBOMText,
} from '../ai/pdf-bom-fallback';

const materialListText = `
70000000006505 U 80 - 690 FZ 4 690 DIN1026 S235JRG2 80009 5,971 kg 23,883 kg
70000000006506 U 50 x 38 - 1090 FZ 1 1090 DIN1026 S235JRG2 80006 6,091 kg 6,091 kg
70000000002584 RU 16 - 60 FZ 2 60 EN 10060 S235JRG2 80285 0,095 kg 0,190 kg
70000000002585 RO 30 - 120 FZ 1 120 EN 10219 S235JRG2 80285 0,500 kg 0,500 kg
70000000006504 BL 20 x 90 x 160 10461.geo FL 2 DIN EN 10130 S235JRG2 82515 1,695 kg 3,390 kg
70000000006510 BL 20 x 65 x 230 10464.geo FL 4 DIN EN 10130 S235JRG2 82515 1,308 kg 5,233 kg
70000000006512 BL 6 x 75 x 280 10465.geo FL 4 DIN EN 10130 S235JRG2 82508 1,000 kg 3,999 kg
70000000009028 BL 3 x 995 x 2318 FZ 1 995 x 2318 DIN EN 10130 S235JRG2 82505 54,414 kg 54,414 kg
70000000012443 BL 2 x 702 x 1656 012442.geo FL 1 DIN EN 10130 S235JRG2 82503 14,933 kg 14,933 kg
70000000012442 BL 2 x 702 x 1656 012442.geo FL 1 DIN EN 10130 S235JRG2 82503 14,933 kg 14,933 kg
70000000006504 BL 20 x 90 x 160 10461.geo FL 2 DIN EN 10130 S235JRG2 82515 1,695 kg 3,390 kg
`;

const parsed = parseDeterministicBOMText(materialListText);
assert.equal(parsed.length, 10);

const scopedAi = {
  ...parsed[0],
  sourcePage: 4,
  parentAssembly: '10461020050000',
  sourcePageGroup: '10461020050000',
  source: 'ai' as const,
};
const repeatedScopedAi = {
  ...scopedAi,
  sourcePage: 6,
};
assert.equal(
  mergeDeterministicBOM([scopedAi, repeatedScopedAi], []).length,
  1,
  'AI rows must stay deduplicated even when deterministic fallback finds no rows'
);
assert.equal(
  mergeDeterministicBOM([scopedAi], [parsed[0]]).length,
  1,
  'unscoped deterministic row must enrich one matching AI row without duplication'
);

const support = parsed.find((entry) => entry.articleNumber === '70000000006512');
assert.ok(support);
assert.equal(support.description, 'BL 6 x 75 x 280');
assert.equal(support.partType, 'sheet');
assert.equal(support.thicknessMm, 6);
assert.equal(support.widthMm, 75);
assert.equal(support.heightMm, 280);
assert.equal(support.quantity, 4);
assert.equal(support.massKg, 1);
assert.equal(support.materialGrade, 'S235JRG2');
assert.equal(support.materialType, 'Сталь');
assert.equal(support.steelTypeRaw, 'S235JRG2');

const channel = parsed.find((entry) => entry.articleNumber === '70000000006506');
assert.ok(channel);
assert.equal(channel.partType, 'channel');
assert.equal(channel.widthMm, 50);
assert.equal(channel.heightMm, 1090);
assert.equal(channel.quantity, 1);
assert.equal(channel.massKg, 6.091);

const round = parsed.find((entry) => entry.articleNumber === '70000000002584');
assert.ok(round);
assert.equal(round.partType, 'round_bar');
assert.equal(round.widthMm, 16);
assert.equal(round.heightMm, 60);
assert.equal(round.quantity, 2);

const tube = parsed.find((entry) => entry.articleNumber === '70000000002585');
assert.ok(tube);
assert.equal(tube.partType, 'tube');
assert.equal(tube.widthMm, 30);
assert.equal(tube.heightMm, 120);
assert.equal(tube.quantity, 1);

const localPdf = '/Users/igorrabov/Downloads/10461020050000_Detail.pdf';
const ledaPdf = path.resolve(__dirname, 'fixtures/real/LEDA_024_00_000_Stol_vanna.pdf');
const bulkSkipPdf = path.resolve(__dirname, 'fixtures/real/LEDA525_Detail.pdf');
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const hierarchy = parseDeterministicBOMPages([
    'Спецификация\nЛЕДА.228.02.000СБ\nДетали\n3ЛЕДА.228.02.001Лист передний1',
    'Лист 2\nЛЕДА.228.02.001\n3ЛЕДА.228.02.001Лист передний1',
    'Спецификация\nЛЕДА.228.03.000\nДетали\n3ЛЕДА.228.02.001Лист передний1',
  ]);
  assert.equal(hierarchy.length, 2, 'same row in different parent assemblies must not be deduplicated');
  assert.deepEqual(
    hierarchy.map((entry) => entry.parentAssembly),
    ['ЛЕДА.228.02.000', 'ЛЕДА.228.03.000']
  );
  assert.deepEqual(hierarchy[0].bomSources, [1, 2], 'neighboring pages of one specification must merge');

  if (existsSync(bulkSkipPdf)) {
    const bulkSkip = await extractDeterministicPdfDataFromPdf(bulkSkipPdf);
    assert.equal(bulkSkip.bom.length, 9, '12-page Bulk skip Materialliste must stay deduplicated to 9 rows');
  }

  if (existsSync(localPdf)) {
    const pdfParsed = await extractDeterministicBOMFromPdf(localPdf);
    assert.equal(pdfParsed.length, 9);
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.description, 'BL 6 x 75 x 280');
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.quantity, 4);
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.massKg, 1);
  }

  if (existsSync(ledaPdf)) {
    const ledaParsed = await extractDeterministicPdfDataFromPdf(ledaPdf);
    assert.equal(ledaParsed.bom.length, 10, 'LEDA PDF BOM should be deduplicated to 9 sheet rows + purchased plug');
    assert.deepEqual(
      ledaParsed.bom.map((entry) => `${entry.position}:${entry.designation || entry.name}:${entry.quantity}`),
      [
        '1:ЛЕДА.024.00.001:1',
        '3:ЛЕДА.024.00.003:4',
        '5:ЛЕДА.024.00.005:4',
        '7:ЛЕДА.024.00.006:2',
        '9:ЛЕДА.024.00.006-01:2',
        '11:ЛЕДА.024.00.006-02:2',
        '13:ЛЕДА.024.00.006-03:2',
        '15:ЛЕДА.024.00.007:1',
        '17:ЛЕДА.024.00.008:2',
        '19:Заглушка пластмассовая 15мм:2',
      ]
    );
    assert.ok(ledaParsed.bom.every((entry) => entry.bomSources && entry.bomSources.length >= 1), 'LEDA BOM rows should retain source pages');
    assert.equal(new Set(ledaParsed.bom.map((entry) => entry.designation || entry.name)).size, 10, 'LEDA BOM should not contain duplicate rows');

    const plug = ledaParsed.bom.find((entry) => entry.name.includes('Заглушка пластмассовая'));
    assert.ok(plug);
    assert.equal(plug.bomSection, 'Прочие изделия');
    assert.equal(plug.partType, 'other');
    assert.equal(plug.quantity, 2);
    assert.equal(plug.thicknessMm, null);

    const angle03 = ledaParsed.details.find((entry) => entry.designation === 'ЛЕДА.024.00.006-03');
    assert.ok(angle03);
    assert.equal(angle03.materialGrade, 'Ст3пс');
    assert.equal(angle03.thicknessMm, 3);
    assert.equal(angle03.unfoldingWidth, 780);
    assert.equal(angle03.unfoldingHeight, 55);
    assert.equal(angle03.sourcePage, 7);
  }

  console.log('[pdf-bom-fallback] all tests passed');
}
