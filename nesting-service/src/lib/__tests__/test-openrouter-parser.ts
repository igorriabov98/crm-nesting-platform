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
assert.equal(parsed.bom[0].quantity, 4);
assert.equal(parsed.details.length, 3);
assert.equal(parsed.details[0].thicknessMm, 3);
assert.equal(parsed.details[0].unfoldingWidth, 360);
assert.equal(parsed.details[1].thicknessMm, 2);
assert.equal(parsed.details[1].unfoldingWidth, null);
assert.match(parsed.details[1].notes, /2мм и 2,5мм/);
assert.equal(parsed.details[2].thicknessMm, 8);
assert.equal(parsed.details[2].materialType, 'Нержавейка');

console.log('[openrouter-parser] all tests passed');
