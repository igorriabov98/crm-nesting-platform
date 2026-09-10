import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  CLIENT_FASTENING_FILE_MAX_BYTES,
  clientFasteningUploadPrefix,
  isProductClientFasteningComplete,
  normalizeClientFasteningTypes,
  validateClientFasteningFile,
  validateDirectClientFasteningUploads,
  type DirectClientFasteningUpload,
} from '../src/lib/products/product-client-fastening'

const productId = '10000000-0000-0000-0000-000000000001'
const versionId = '20000000-0000-0000-0000-000000000001'
const clientId = '30000000-0000-0000-0000-000000000001'

function upload(type: 'metal_plate' | 'a4_plate', fileName: string): DirectClientFasteningUpload {
  return {
    objectPath: `${clientFasteningUploadPrefix(productId, versionId, clientId, type)}fixture-${fileName}`,
    fasteningType: type,
    fileName,
    mimeType: 'application/octet-stream',
    fileSize: 1024,
  }
}

assert.deepEqual(
  normalizeClientFasteningTypes(['white_sticker', 'metal_plate', 'white_sticker']),
  ['metal_plate', 'white_sticker'],
)
assert.throws(() => normalizeClientFasteningTypes(['wp_plate']), /больше не используются/u)

assert.equal(validateClientFasteningFile({ fasteningType: 'a4_plate', fileName: 'layout.dwg', fileSize: 12 }).extension, '.dwg')
assert.equal(validateClientFasteningFile({ fasteningType: 'metal_plate', fileName: 'data.custom42', fileSize: CLIENT_FASTENING_FILE_MAX_BYTES }).extension, '.custom42')
assert.throws(
  () => validateClientFasteningFile({ fasteningType: 'metal_plate', fileName: '../secret.dwg', fileSize: 12 }),
  /недопустимые символы/u,
)
assert.throws(
  () => validateClientFasteningFile({ fasteningType: 'metal_plate', fileName: 'plate.dwg', fileSize: CLIENT_FASTENING_FILE_MAX_BYTES + 1 }),
  /50 МБ/u,
)

assert.equal(
  validateDirectClientFasteningUploads(
    productId,
    versionId,
    clientId,
    ['metal_plate', 'a4_plate'],
    [upload('metal_plate', 'metal.zip'), upload('a4_plate', 'a4.xlsx')],
  ).length,
  2,
)
assert.throws(
  () => validateDirectClientFasteningUploads(
    productId,
    versionId,
    clientId,
    ['metal_plate'],
    [upload('metal_plate', 'one.dwg'), upload('metal_plate', 'two.dwg')],
  ),
  /только один файл/u,
)
assert.throws(
  () => validateDirectClientFasteningUploads(productId, versionId, clientId, ['white_sticker'], [upload('a4_plate', 'a4.pdf')]),
  /невыбранного типа/u,
)

const complete = (completionType: 'mounting_set' | null, fasteningTypes: Parameters<typeof isProductClientFasteningComplete>[0]['fasteningTypes'], fileTypes: string[]) =>
  isProductClientFasteningComplete({ completionType, fasteningTypes, fileTypes })

assert.equal(complete(null, ['white_sticker'], []), false)
assert.equal(complete('mounting_set', [], []), false)
assert.equal(complete('mounting_set', ['white_sticker'], []), true)
assert.equal(complete('mounting_set', ['metal_plate'], []), false)
assert.equal(complete('mounting_set', ['metal_plate'], ['metal_plate']), true)
assert.equal(complete('mounting_set', ['metal_plate', 'a4_plate'], ['metal_plate']), false)
assert.equal(complete('mounting_set', ['metal_plate', 'a4_plate'], ['metal_plate', 'a4_plate']), true)

const root = path.resolve(import.meta.dirname, '..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260910120000_product_version_client_fastening.sql'), 'utf8')
const versionActions = fs.readFileSync(path.join(root, 'src/lib/actions/product-versions.ts'), 'utf8')
const fasteningActions = fs.readFileSync(path.join(root, 'src/lib/actions/product-client-fastening.ts'), 'utf8')
const downloadRoute = fs.readFileSync(path.join(root, 'src/app/api/products/client-fastening/files/[id]/route.ts'), 'utf8')
const versionUi = fs.readFileSync(path.join(root, 'src/components/features/products/ProductVersionHistory.tsx'), 'utf8')

assert.match(migration, /unique \(product_version_id, client_id\)/u)
assert.match(migration, /unique \(setting_id, fastening_type\)/u)
assert.match(migration, /revoke all on table public\.product_version_client_fastening_settings from public, anon, authenticated/u)
assert.match(migration, /array_remove\([\s\S]*?'wp_plate'/u)
assert.match(migration, /product_version_id, client_id, assigned_to/u)
assert.match(migration, /fn_copy_product_version_client_fastening_settings/u)
assert.match(migration, /after insert or update of file_path/u)
assert.match(versionActions, /fn_copy_product_version_client_fastening_settings/u)
assert.match(versionActions, /fastening_types: \[\]/u)
assert.match(fasteningActions, /removeFileObject\('product-files'/u)
assert.match(downloadRoute, /disposition: 'attachment'/u)
assert.doesNotMatch(versionUi, /Таблички на WP/u)
assert.doesNotMatch(versionUi, /fasteningTypes,/u)

console.log('Product client fastening unit and source-contract scenarios passed')
