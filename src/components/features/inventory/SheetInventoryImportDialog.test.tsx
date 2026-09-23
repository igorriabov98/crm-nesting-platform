import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SheetImportPreviewContent } from './SheetInventoryImportDialog'
import type { SheetImportPreview } from '@/lib/inventory/sheet-import-types'

test('preview names the destination, new catalogue entries, previous receipt and blocking rows', () => {
  const preview: SheetImportPreview = { rows: [{ row:2,material:'Лист рифленный',grade:'235',thickness:2,width:1000,length:2000,quantity:10,density:7.85,supplier:null,comment:null,materialId:null,steelTypeId:null,variantId:null,supplierId:null,weightKg:314 }], errors:[{row:3,message:'Укажите плотность новой марки'}], skippedRows:[4],quantity:10,weightKg:314,newMaterials:1,newGrades:1,newVariants:1,fingerprint:'hash',previewHash:'preview',previous:{id:'prior',fileName:'stock.xlsx',createdAt:'2026-09-22T12:00:00Z',author:'Кладовщик',quantity:10} }
  const html = renderToStaticMarkup(<SheetImportPreviewContent preview={preview} factoryName="Ужгород" />)
  for (const text of ['Основной склад','Ужгород','Лист рифленный','Новая марка','7.85','stock.xlsx','Кладовщик','добавит ещё','Ни одна строка','Укажите плотность','Не указан']) assert.ok(html.includes(text),text)
})
