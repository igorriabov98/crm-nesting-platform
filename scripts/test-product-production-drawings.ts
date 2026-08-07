import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRODUCT_PRODUCTION_DRAWING_BUCKET,
  PRODUCT_PRODUCTION_DRAWING_MAX_BYTES,
  PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH,
  productProductionDrawingUploadPrefix,
  validateDirectProductProductionDrawingUploads,
  validateProductProductionDrawingFile,
  type DirectProductProductionDrawingUpload,
} from '../src/lib/products/product-production-drawing'

const productId = '11111111-1111-4111-8111-111111111111'
const productVersionId = '22222222-2222-4222-8222-222222222222'
const prefix = productProductionDrawingUploadPrefix(productId, productVersionId)

function upload(index: number): DirectProductProductionDrawingUpload {
  return {
    objectPath: `${prefix}${index}.pdf`,
    fileName: `detail-${index}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 1024,
  }
}

assert.equal(PRODUCT_PRODUCTION_DRAWING_BUCKET, 'product-production-drawings')
assert.equal(PRODUCT_PRODUCTION_DRAWING_MAX_BYTES, 50 * 1024 * 1024)
assert.equal(PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH, 10)
assert.equal(validateProductProductionDrawingFile(upload(1)).fileName, 'detail-1.pdf')
assert.throws(() => validateProductProductionDrawingFile({ fileName: 'drawing.dwg', fileSize: 10 }), /PDF/u)
assert.throws(() => validateProductProductionDrawingFile({ fileName: 'drawing.pdf', fileSize: 0 }), /пустой/u)
assert.throws(
  () => validateProductProductionDrawingFile({ fileName: 'drawing.pdf', fileSize: PRODUCT_PRODUCTION_DRAWING_MAX_BYTES + 1 }),
  /50 МБ/u,
)
assert.throws(
  () => validateProductProductionDrawingFile({ fileName: 'drawing.pdf', fileSize: 10, mimeType: 'image/png' }),
  /PDF/u,
)

assert.throws(() => validateDirectProductProductionDrawingUploads(productId, productVersionId, []), /хотя бы один/u)
assert.throws(
  () => validateDirectProductProductionDrawingUploads(
    productId,
    productVersionId,
    Array.from({ length: 11 }, (_, index) => upload(index)),
  ),
  /не больше 10/u,
)
assert.equal(
  validateDirectProductProductionDrawingUploads(
    productId,
    productVersionId,
    Array.from({ length: 10 }, (_, index) => upload(index)),
  ).length,
  10,
)
assert.throws(
  () => validateDirectProductProductionDrawingUploads(productId, productVersionId, [{
    ...upload(1),
    objectPath: 'products/another-product/versions/another-version/uploads/file.pdf',
  }]),
  /путь/u,
)
assert.throws(
  () => validateDirectProductProductionDrawingUploads(productId, productVersionId, [{
    ...upload(1),
    objectPath: `${prefix}../file.pdf`,
  }]),
  /путь/u,
)
assert.throws(
  () => validateDirectProductProductionDrawingUploads(productId, productVersionId, [upload(1), upload(1)]),
  /дважды/u,
)

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/20260803120000_product_production_drawings.sql'), 'utf8')
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.product_production_drawings'))
assert(migration.includes("VALUES ('product-production-drawings', 'product-production-drawings', false, 52428800)"))
assert(/REVOKE ALL ON TABLE public\.product_production_drawings FROM PUBLIC, anon, authenticated/u.test(migration))
assert(!/CREATE POLICY[\s\S]*?product_production_drawings[\s\S]*?TO authenticated/iu.test(migration))
assert(!/CREATE POLICY[\s\S]*?product-production-drawings[\s\S]*?TO authenticated/iu.test(migration))

const access = readFileSync(join(root, 'src/lib/products/product-production-drawing-access.ts'), 'utf8')
assert(access.includes("requirePermission('products', 'view')"))
assert(access.includes("hasPermission(context.permissions, 'product_production_drawings', operation)"))

const actions = readFileSync(join(root, 'src/lib/actions/product-production-drawings.ts'), 'utf8')
assert(actions.includes("requireProductProductionDrawingAccess('view')"))
assert(actions.includes("requireProductProductionDrawingAccess('manage')"))
assert(actions.includes('currentOnly: true'))
assert(actions.includes("headers: { Range: 'bytes=0-4' }"))
assert(actions.includes("new TextDecoder().decode(signature) !== '%PDF-'"))
assert(!actions.includes("from('product_files')"), 'Комплектные чертежи не должны попадать в общую таблицу файлов')

const versionActions = readFileSync(join(root, 'src/lib/actions/product-versions.ts'), 'utf8')
assert(!versionActions.includes('product_production_drawings'), 'Новая версия не должна копировать производственный комплект')
const completeness = readFileSync(join(root, 'src/lib/products/product-file-upload.ts'), 'utf8')
assert(!completeness.includes('product_production_drawings'), 'Готовность основных файлов не должна зависеть от производственного комплекта')

const uploadRoute = readFileSync(join(root, 'src/app/api/products/production-drawings/upload-url/route.ts'), 'utf8')
const downloadRoute = readFileSync(join(root, 'src/app/api/products/production-drawings/[id]/route.ts'), 'utf8')
assert(uploadRoute.includes("requireProductProductionDrawingAccess('manage')"))
assert(uploadRoute.includes('requireOwnedVersion(input.productId, input.productVersionId, true)'))
assert(uploadRoute.includes('requireOwnedVersion(input.productId, input.productVersionId, false)'))
assert(downloadRoute.includes("requireProductProductionDrawingAccess('view')"))
assert(downloadRoute.includes('resolveFileResponse({'))
assert(downloadRoute.includes('objectPath: drawing.file_path'))

console.log('product-production-drawings: OK')
