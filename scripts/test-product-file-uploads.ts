import assert from 'node:assert/strict'
import {
  PRODUCT_FILE_MAX_BYTES,
  productUploadPrefix,
  validateDirectProductUploads,
  validateProductUploadRequest,
  versionDocumentState,
  type DirectProductUpload,
} from '../src/lib/products/product-file-upload'

const productId = '3e8d8996-50b0-4056-87b2-614f81c57473'

function upload(fileKind: 'drawing' | 'step', fileName: string): DirectProductUpload {
  return {
    objectPath: `${productUploadPrefix(productId)}fixture-${fileName}`,
    fileKind,
    fileName,
    mimeType: fileKind === 'drawing' ? 'application/pdf' : 'application/octet-stream',
    fileSize: 1024,
  }
}

function expectThrow(action: () => unknown, expectedMessage: RegExp) {
  assert.throws(action, expectedMessage)
}

assert.equal(validateDirectProductUploads(productId, [upload('drawing', 'drawing.pdf')], { versionFilesOnly: true }).length, 1)
assert.equal(validateDirectProductUploads(productId, [upload('step', 'model.step')], { versionFilesOnly: true }).length, 1)
assert.equal(
  validateDirectProductUploads(productId, [upload('drawing', 'drawing.pdf'), upload('step', 'model.stp')], { versionFilesOnly: true }).length,
  2,
)

expectThrow(
  () => validateDirectProductUploads(productId, [], { versionFilesOnly: true }),
  /PDF или STEP/,
)
expectThrow(
  () => validateDirectProductUploads(productId, [upload('drawing', 'a.pdf'), upload('drawing', 'b.pdf')], { versionFilesOnly: true }),
  /два файла одного типа/,
)
expectThrow(
  () => validateDirectProductUploads(productId, [{ ...upload('drawing', 'drawing.pdf'), objectPath: 'products/other/uploads/drawing.pdf' }], { versionFilesOnly: true }),
  /Некорректный путь/,
)
expectThrow(
  () => validateDirectProductUploads(productId, [{ ...upload('drawing', 'drawing.pdf'), objectPath: `${productUploadPrefix(productId)}drawing.step` }], { versionFilesOnly: true }),
  /Расширение загруженного файла/,
)
expectThrow(
  () => validateProductUploadRequest({ fileKind: 'step', fileName: 'model.pdf', fileSize: 1024 }),
  /Допустимые форматы/,
)
expectThrow(
  () => validateDirectProductUploads(productId, [upload('drawing', 'drawing.dxf')], { versionFilesOnly: true }),
  /формате PDF/,
)
expectThrow(
  () => validateProductUploadRequest({ fileKind: 'drawing', fileName: 'drawing.pdf', fileSize: PRODUCT_FILE_MAX_BYTES + 1 }),
  /50 МБ/,
)

assert.deepEqual(versionDocumentState([{ file_kind: 'drawing' }]), {
  hasDrawing: true,
  hasStep: false,
  complete: false,
})
assert.deepEqual(versionDocumentState([{ file_kind: 'step' }]), {
  hasDrawing: false,
  hasStep: true,
  complete: false,
})
assert.deepEqual(versionDocumentState([{ file_kind: 'pdf' }, { file_kind: 'step' }]), {
  hasDrawing: true,
  hasStep: true,
  complete: true,
})

console.log('Product file upload scenarios passed')
