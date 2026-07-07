import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { extractDeterministicBOMFromPdf, extractDeterministicPdfDataFromPdf, parseDeterministicBOMText } from '../ai/pdf-bom-fallback';

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
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  if (existsSync(localPdf)) {
    const pdfParsed = await extractDeterministicBOMFromPdf(localPdf);
    assert.equal(pdfParsed.length, 9);
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.description, 'BL 6 x 75 x 280');
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.quantity, 4);
    assert.equal(pdfParsed.find((entry) => entry.articleNumber === '70000000006512')?.massKg, 1);
  }

  if (existsSync(ledaPdf)) {
    const ledaParsed = await extractDeterministicPdfDataFromPdf(ledaPdf);
    const plug = ledaParsed.bom.find((entry) => entry.name.includes('Заглушка пластмассовая'));
    assert.ok(plug);
    assert.equal(plug.bomSection, 'Прочие изделия');
    assert.equal(plug.partType, 'other');
    assert.equal(plug.quantity, 2);
    assert.equal(plug.thicknessMm, null);
  }

  console.log('[pdf-bom-fallback] all tests passed');
}
