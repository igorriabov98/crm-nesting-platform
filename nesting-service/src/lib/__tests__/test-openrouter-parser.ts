import assert from 'node:assert/strict';
import { parsePDFAnalysisResponse } from '../ai/openrouter';

const parsed = parsePDFAnalysisResponse(JSON.stringify({
  bom: [
    { position: '1', designation: 'ЛЕДА.024.00.005', name: 'Стойка', quantity: 4 },
    { position: '2', designation: 'ЛЕДА.024.00.001', name: 'Обшивка верхняя', quantity: 1 },
    { position: '3', designation: 'ЛЕДА.024.00.010', name: 'Ножка-опора', quantity: 4 },
  ],
  details: [
    {
      designation: 'ЛЕДА.024.00.005',
      name: 'Стойка',
      material_full: 'Лист Б-ПН-3 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97',
      material_type: 'Сталь',
      material_grade: 'Ст3пс',
      thickness_mm: 3,
      unfolding_width: 360,
      unfolding_height: 55,
      mass_kg: 0.47,
      is_sheet_metal: true,
      notes: '',
    },
    {
      designation: 'ЛЕДА.024.00.001',
      name: 'Обшивка верхняя',
      material_full: 'Лист БТ-ПН-2,0 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97',
      material_type: 'Сталь',
      material_grade: 'Ст3пс',
      thickness_mm: 2.0,
      unfolding_width: null,
      unfolding_height: null,
      mass_kg: null,
      is_sheet_metal: true,
      notes: 'Допускается изготавливать из листа толщиной 2мм и 2,5мм',
    },
    {
      designation: 'ЛЕДА.024.00.010',
      name: 'Ножка-опора',
      material_full: 'Лист БТ-ПН-8 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97',
      material_type: '12Х18Н10Т',
      material_grade: '12Х18Н10Т',
      thickness_mm: 8,
      unfolding_width: 495,
      unfolding_height: 100,
      mass_kg: 2.2,
      is_sheet_metal: true,
      notes: '',
    },
  ],
}));

assert.equal(parsed.bom.length, 3);
assert.equal(parsed.bom[0].designation, 'ЛЕДА.024.00.005');
assert.equal(parsed.bom[0].description, 'Стойка');
assert.equal(parsed.bom[0].partType, 'other');
assert.equal(parsed.bom[0].quantity, 4);
assert.equal(parsed.details.length, 3);
assert.equal(parsed.details[0].thicknessMm, 3);
assert.equal(parsed.details[0].unfoldingWidth, 360);
assert.equal(parsed.details[1].thicknessMm, 2);
assert.equal(parsed.details[1].unfoldingWidth, null);
assert.match(parsed.details[1].notes, /2мм и 2,5мм/);
assert.equal(parsed.details[2].thicknessMm, 8);
assert.equal(parsed.details[2].materialType, 'Нержавейка');

const germanParsed = parsePDFAnalysisResponse(JSON.stringify({
  bom: [
    {
      source_page: 4,
      parent_assembly: '10461',
      position: '1',
      article_number: '70000000006505',
      designation: '10461.geo',
      description: 'BL 3 x 995 x 2318',
      part_type: 'sheet',
      thickness_mm: null,
      width_mm: null,
      height_mm: null,
      quantity: 1,
      mass_kg: '54,41',
      material_grade: 'S235JRG2',
      material_type: 'S235JRG2',
      norm: 'DIN EN 10130',
    },
    {
      position: '6',
      article_number: '',
      designation: '',
      description: 'U 80 - 690',
      part_type: 'channel',
      thickness_mm: null,
      width_mm: null,
      height_mm: null,
      quantity: '4',
      mass_kg: 5.97,
      material_grade: 'S235JRG2',
      material_type: '',
      norm: '',
    },
    {
      position: '8',
      article_number: '',
      designation: '',
      description: 'RU 16 - 60',
      part_type: 'round_bar',
      thickness_mm: null,
      width_mm: null,
      height_mm: null,
      quantity: 2,
      mass_kg: 0.095,
      material_grade: 'S235JRG2',
      material_type: 'Сталь',
      norm: '',
    },
  ],
  details: [],
}));

assert.equal(germanParsed.bom.length, 3);
assert.equal(germanParsed.bom[0].articleNumber, '70000000006505');
assert.equal(germanParsed.bom[0].partType, 'sheet');
assert.equal(germanParsed.bom[0].thicknessMm, 3);
assert.equal(germanParsed.bom[0].widthMm, 995);
assert.equal(germanParsed.bom[0].heightMm, 2318);
assert.equal(germanParsed.bom[0].massKg, 54.41);
assert.equal(germanParsed.bom[0].materialType, 'Сталь');
assert.equal(germanParsed.bom[0].sourcePage, 4);
assert.equal(germanParsed.bom[0].parentAssembly, '10461');
assert.equal(germanParsed.bom[0].source, 'ai');
assert.equal(germanParsed.bom[1].partType, 'channel');
assert.equal(germanParsed.bom[1].widthMm, 80);
assert.equal(germanParsed.bom[1].heightMm, 690);
assert.equal(germanParsed.bom[1].quantity, 4);
assert.equal(germanParsed.bom[2].partType, 'round_bar');
assert.equal(germanParsed.bom[2].widthMm, 16);
assert.equal(germanParsed.bom[2].heightMm, 60);

console.log('[openrouter-parser] all tests passed');
