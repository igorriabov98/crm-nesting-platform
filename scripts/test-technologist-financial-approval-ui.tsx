import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as icons from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as buttons from '../src/components/ui/button'
import * as dialogs from '../src/components/ui/dialog'
import * as textareas from '../src/components/ui/textarea'
import * as procurement from '../src/lib/constants/procurement'
import * as approval from '../src/lib/technologist-request-approval'
import * as approvalBadge from '../src/lib/technologist-approval-badge'
import { ApprovalSummary, ApprovalDiff } from '../src/components/features/technologist/ApprovalSummary'

function load<T>(path: string, imports: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require(name: string) {
    assert.ok(name in imports, `Unexpected import ${name}`)
    return imports[name]
  } })
  return loadedModule.exports as T
}

const actions = load<{ ApprovalDecisionActions: React.ComponentType<{
  requestId: string; versionId: string; canEdit: boolean; canReview: boolean; pending: boolean
}> }>('src/components/features/technologist/ApprovalDecisionActions.tsx', {
  react: React, 'react/jsx-runtime': jsx, 'next/navigation': { useRouter: () => ({ refresh() {}, push() {} }) },
  'lucide-react': icons, sonner: { toast: {} }, '@/components/ui/button': buttons,
  '@/components/ui/dialog': dialogs, '@/components/ui/textarea': textareas,
  '@/lib/actions/technologist-request-approvals': {},
})

for (const [role, canEdit, canReview, expectedEdit, expectedApprove] of [
  ['technologist',true,false,true,false], ['financial_director',false,true,false,true],
  ['crm_administrator',false,true,false,true], ['no_access',false,false,false,false],
] as const) test(`${role}: only authorised decision buttons are rendered`, () => {
  const html = renderToStaticMarkup(<actions.ApprovalDecisionActions requestId="request" versionId="version" canEdit={canEdit} canReview={canReview} pending />)
  assert.equal(html.includes('Редактировать заявку'), expectedEdit)
  assert.equal(html.includes('Одобрить заявку'), expectedApprove)
  assert.equal(html.includes('Вернуть на доработку'), expectedApprove)
})

test('approved version has no editing or decision buttons', () => {
  const html = renderToStaticMarkup(<actions.ApprovalDecisionActions requestId="request" versionId="version" canEdit={false} canReview pending={false} />)
  assert.equal(html, '')
})

const snapshot: approval.ApprovalSummarySnapshot = {
  schemaVersion: 1, requestId: 'request', machineId: 'machine', orderName: 'Заказ', materialType: 'standard',
  items: [{ key: 'request_sheet_metal:a', category: 'request_sheet_metal', categoryLabel: 'Листовой металл',
    name: 'Лист S235', quantity: 3, unit: 'шт.', weightKg: 100, businessScrapReserved: 1, regularStockReserved: 2, wastePercent: 10 }],
  futureItems: [{ name: 'Заготовка', drawingNumber: 'Ч-001', quantity: 4, unitWeightKg: 2 }], enteredPlasmaMinutes: 20, archives: [],
}

const circleSnapshot: approval.ApprovalSummarySnapshot = {
  ...snapshot,
  items: [
    { key: 'request_circle:a', category: 'request_circle', categoryLabel: 'Круг', name: 'Hardox', quantity: 6000, unit: 'мм', weightKg: 33.08,
      businessScrapReserved: 0, regularStockReserved: 5532, wastePercent: null,
      attributes: { steel_grade: 'Hardox', diameter_mm: 30, is_calibrated: false } },
    { key: 'request_circle:b', category: 'request_circle', categoryLabel: 'Круг', name: 'Hardox', quantity: 6000, unit: 'мм', weightKg: 14.7,
      businessScrapReserved: 0, regularStockReserved: 0, wastePercent: null,
      attributes: { steel_grade: 'Hardox', diameter_mm: 20, is_calibrated: true } },
  ],
}

test('summary renders desktop table, mobile cards, exact reservations, waste and future detailing', () => {
  const html = renderToStaticMarkup(<ApprovalSummary snapshot={snapshot} />)
  for (const text of ['Лист S235','Деловой склад','Обычный склад','10.0%','Заготовка','Ч-001','25 мин.','md:block','md:hidden']) assert.ok(html.includes(text), text)
  assert.ok(html.includes('1 шт.'))
  assert.ok(html.includes('2 шт.'))
  assert.ok(!html.includes('id="category-'), 'History summaries must not duplicate document IDs')
})

test('summary shows complete technical details that distinguish equal material names', () => {
  const html = renderToStaticMarkup(<ApprovalSummary snapshot={circleSnapshot} />)
  for (const text of ['Марка стали: Hardox', 'Диаметр: 30 мм', 'Диаметр: 20 мм', 'Калиброванный: нет', 'Калиброванный: да', 'Вес позиции: 33,08 кг', 'Вес позиции: 14,7 кг']) {
    assert.ok(html.includes(text), text)
  }
})

test('summary does not present empty paint measurements as real position data', () => {
  const paintSnapshot = { ...snapshot, items: [{
    key: 'request_paint:a', category: 'request_paint', categoryLabel: 'Краска', name: 'RAL 6050 · матовый',
    quantity: 10, unit: 'кг', weightKg: 0, businessScrapReserved: 0, regularStockReserved: 0, wastePercent: null,
    attributes: { area_m2: 0, weight_with_waste_kg: 0 },
  }] }
  const html = renderToStaticMarkup(<ApprovalSummary snapshot={paintSnapshot} />)
  assert.ok(html.includes('10 кг'))
  assert.ok(!html.includes('Площадь: 0 м²'))
  assert.ok(!html.includes('Вес с запасом: 0 кг'))
  assert.ok(!html.includes('Вес позиции: 0 кг'))
})

test('version comparison displays before and after values', () => {
  const next = { ...snapshot, items: snapshot.items.map((item) => ({ ...item, quantity: 7 })) }
  const html = renderToStaticMarkup(<ApprovalDiff diff={approval.compareApprovalSnapshots(snapshot, next)} />)
  assert.ok(html.includes('количество: 3 → 7'))
})

test('history does not fetch or render snapshots before opening', () => {
  const history = load<{ ApprovalVersionHistory: React.ComponentType<{ requestId: string; versions: Array<{id:string;revision_number:number;state:string;is_legacy:boolean}> }> }>('src/components/features/technologist/ApprovalVersionHistory.tsx', {
    react: React, 'react/jsx-runtime': jsx, 'lucide-react': icons, '@/components/ui/badge': { Badge: 'span' },
    '@/components/ui/button': buttons, '@/lib/actions/technologist-request-approvals': {
      getTechnologistApprovalHistoryVersion() { throw new Error('History must be loaded on demand') },
    }, '@/lib/technologist-request-approval': approval,
    '@/lib/technologist-approval-badge': approvalBadge,
    './ApprovalSummary': { ApprovalSummary, ApprovalDiff },
  })
  const html = renderToStaticMarkup(<history.ApprovalVersionHistory requestId="request" versions={[{ id:'version', revision_number:1, state:'returned', is_legacy:false }]} />)
  assert.ok(html.includes('<summary'))
  assert.ok(html.includes('Версия 1.1'))
  assert.ok(html.includes('Подробнее'))
  assert.ok(html.includes('focus-visible:'))
  assert.ok(!html.includes('<table'))
})

test('snapshot uses authoritative source rows without changing their order and labels wire in kilograms', () => {
  const helper = load<{ snapshotFromSource: (source: Record<string, unknown[]>, id: string, machine: {id:string;name:string;material_type:string}, input: unknown) => approval.ApprovalSummarySnapshot }>('src/lib/server/technologist-approval-snapshot.ts', {
    'server-only': {}, '@/lib/constants/procurement': procurement,
  })
  const source = { request_pipe: [
    { id:'b', pipe_type:'wire', sort_order:2, remainder_length_mm:0, remainder_kg:12, calculated_weight_kg:12 },
    { id:'a', pipe_type:'round', sort_order:1, remainder_length_mm:1000 },
  ], request_paint: [
    { id:'paint-id', paint_type:'Порошковая краска', ral_code:'RAL 7016', finish:'Матовая', remainder_kg:15, weight_with_waste_kg:15 },
  ], reservations: [{ request_item_table:'request_pipe', request_item_id:'b', logical_reserved_quantity:5, is_business_scrap:true }] }
  const before = JSON.stringify(source)
  const result = helper.snapshotFromSource(source,'request',{id:'machine',name:'Заказ',material_type:'standard'}, { decision:'none', enteredPlasmaMinutes:0, wasteItems:[], futureItems:[], archives:[] })
  assert.equal(JSON.stringify(source), before)
  const wire = result.items.find((item) => item.key === 'request_pipe:b')!
  assert.equal(wire.name, 'Проволока')
  assert.equal(wire.quantity, 12)
  assert.equal(wire.unit, 'кг')
  assert.equal(wire.businessScrapReserved, 5)
  const paint = result.items.find((item) => item.key === 'request_paint:paint-id')!
  assert.equal(paint.name, 'Порошковая краска · RAL 7016 · Матовая')
  assert.equal(paint.quantity, 15)
  assert.notEqual(paint.name, 'Позиция paint-id')
})
