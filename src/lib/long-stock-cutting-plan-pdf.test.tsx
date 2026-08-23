import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import {
  LONG_STOCK_CUTTING_PLAN_PDF_BUCKET,
  calculateLongStockPdfRemainder,
  longStockCuttingPlanPdfDecision,
  longStockCuttingPlanPdfObjectPath,
  parseLongStockCuttingPlanPdfMetadata,
  summarizeLongStockPdfCuts,
  type LongStockCuttingPlanPdfData,
  type LongStockCuttingPlanPdfMetadata,
} from './long-stock-cutting-plan-pdf'
import { LongStockCuttingPlanDocument } from './pdf/LongStockCuttingPlanDocument'

const planId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
const artifactId = '44444444-4444-4444-8444-444444444444'

function metadata(overrides: Partial<LongStockCuttingPlanPdfMetadata> = {}): LongStockCuttingPlanPdfMetadata {
  return {
    schema_version: 1,
    bucket_id: LONG_STOCK_CUTTING_PLAN_PDF_BUCKET,
    object_path: longStockCuttingPlanPdfObjectPath(planId, versionId, artifactId),
    file_name: 'cutting-plan-17-v1.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    sha256: 'a'.repeat(64),
    generated_by: actorId,
    generated_at: '2026-08-18T09:30:00.000Z',
    ...overrides,
  }
}

const sampleData: LongStockCuttingPlanPdfData = {
  planNumber: 17,
  versionNumber: 1,
  generatedAt: '2026-08-18T09:30:00.000Z',
  requestNumber: 3,
  factoryName: 'Завод 1',
  technologistName: 'Иван Технолог',
  materialName: 'Нож Hardox',
  materialVariantLabel: '6000×120×12',
  metalType: 'Hardox 500',
  knifeBevel: '1 скос',
  kerfMm: 2,
  endTrimMm: 5,
  bars: [
    {
      barNumber: 1,
      stockLengthMm: 6000,
      cuts: [
        { cutNumber: 1, lengthMm: 1200 },
        { cutNumber: 2, lengthMm: 1200 },
        { cutNumber: 3, lengthMm: 800 },
      ],
      remainderMm: 2789,
    },
    {
      barNumber: 2,
      stockLengthMm: 8500,
      cuts: [{ cutNumber: 1, lengthMm: 6000 }],
      remainderMm: 2493,
    },
  ],
  totals: [
    { lengthMm: 6000, quantity: 1 },
    { lengthMm: 1200, quantity: 2 },
    { lengthMm: 800, quantity: 1 },
  ],
}

test('approved version reuses one immutable PDF metadata record', () => {
  const stored = metadata()
  const first = longStockCuttingPlanPdfDecision('approved', stored, { planId, versionId })
  const second = longStockCuttingPlanPdfDecision('approved', stored, { planId, versionId })
  assert.equal(first.kind, 'stored')
  assert.deepEqual(second, first)
  assert.deepEqual(parseLongStockCuttingPlanPdfMetadata(stored, { planId, versionId }), stored)
})

test('a new plan version gets a distinct immutable object path', () => {
  const nextVersionId = '55555555-5555-4555-8555-555555555555'
  const firstPath = longStockCuttingPlanPdfObjectPath(planId, versionId, artifactId)
  const secondPath = longStockCuttingPlanPdfObjectPath(planId, nextVersionId, artifactId)
  assert.notEqual(firstPath, secondPath)
  assert(firstPath.includes(`/${versionId}/`))
  assert(secondPath.includes(`/${nextVersionId}/`))
})

test('invalid version cannot expose its stored PDF', () => {
  const decision = longStockCuttingPlanPdfDecision('invalid', metadata(), { planId, versionId })
  assert.deepEqual(decision, { kind: 'unavailable', reason: 'recalculation_required' })
})

test('bar remainder and total cut composition follow the sealed layout', () => {
  assert.equal(calculateLongStockPdfRemainder(6000, [
    { lengthMm: 1200 },
    { lengthMm: 1200 },
    { lengthMm: 800 },
  ], 2, 5), 2789)
  assert.deepEqual(summarizeLongStockPdfCuts(sampleData.bars), sampleData.totals)
})

test('two downloads of one stored version return identical PDF bytes', async () => {
  const element = createElement(LongStockCuttingPlanDocument, { data: sampleData }) as Parameters<typeof renderToBuffer>[0]
  const storedBytes = await renderToBuffer(element)
  assert.equal(storedBytes.subarray(0, 4).toString(), '%PDF')
  const downloadStored = async () => Buffer.from(storedBytes)
  const [first, second] = await Promise.all([downloadStored(), downloadStored()])
  assert.equal(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(second).digest('hex'))
})

test('download route only resolves the stored object and cutting-area UI blocks invalid versions', () => {
  const route = readFileSync('src/app/api/production/cutting-area/cutting-plans/[versionId]/route.ts', 'utf8')
  const action = readFileSync('src/lib/actions/long-stock-cutting-plans.ts', 'utf8')
  const page = readFileSync('src/components/features/production/CuttingAreaPage.tsx', 'utf8')
  const migration = readFileSync('supabase/migrations/20260818160000_long_stock_cutting_plan_pdf.sql', 'utf8')
  const bucketMigration = readFileSync('supabase/migrations/103_product_catalog_and_projects.sql', 'utf8')
  assert(route.includes('resolveFileResponse'))
  assert(!route.includes('renderToBuffer'))
  assert(route.includes("version.status === 'invalid'"))
  assert(action.includes('prepareLongStockCuttingPlanPdf'))
  assert(action.includes("'fn_approve_long_stock_cutting_plan_version_v2'"))
  assert(page.includes('Карты раскроя'))
  assert(page.includes('требуется пересчёт'))
  assert(migration.includes("old.pdf_metadata <> '{}'::jsonb"))
  assert(bucketMigration.includes("VALUES ('product-files', 'product-files', false"))
})
