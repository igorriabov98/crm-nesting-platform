import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentData } from '../src/lib/actions/document-generation'
import { InvoiceDocument } from '../src/lib/pdf/InvoiceDocument'
import { SpecificationDocument } from '../src/lib/pdf/SpecificationDocument'
import { PackingListDocument } from '../src/lib/pdf/PackingListDocument'

const data: DocumentData = {
  machine: {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Customs QA machine',
    specification_number: 'CUSTOMS-2026-001',
    specification_date: '2026-09-04',
    packing_boxes_count: 3,
  },
  contract: { number: 'CT-2026-09', date: '2026-08-20' },
  client: {
    name: 'Example Industries GmbH',
    address: 'Industriestrasse 10',
    country_city: 'Berlin, Germany',
    delivery_basis_location_en: 'Berlin, Germany',
    delivery_basis_location_ua: 'Берлін, Німеччина',
    director_name: 'Max Mustermann',
    signature_image_path: null,
    stamp_image_path: null,
  },
  company: {
    name_en: 'LEDA WEST LLC',
    name_ua: 'ТОВ «ЛЕДА ВЕСТ»',
    address_en: 'Berehove, Ukraine',
    director_name_en: 'Director',
    director_name_ua: 'Директор',
    enterprise_code: '00000000',
    iban: 'UA000000000000000000000000000',
    swift: 'TESTUA00',
    bank_name: 'Test Bank',
    bank_address: 'Kyiv, Ukraine',
    delivery_basis_en: 'FCA – Berehove, Ukraine',
    delivery_basis_ua: 'FCA – Берегове, Україна',
    intermediary_bank_name: '',
    intermediary_bank_swift: '',
    signature_image_path: null,
    stamp_image_path: null,
  },
  items: [{
    sort_order: 1,
    product_name_en: 'Industrial machine assembly',
    product_name_uk: 'Промисловий машинний вузол',
    product_uktzed: '8431 20 00 00',
    quantity: 2,
    price: 1250,
    total: 2500,
    weight: 320,
    net_weight: 640,
    coating: 'powder_coating',
    ral_number: 'RAL 5010',
  }],
  expenses: [],
  packingGroups: [{
    start_item_number: 1,
    end_item_number: 1,
    packing_type_en: 'Wooden box',
    packing_type_ua: 'Дерев’яний ящик',
    places: 3,
    sort_order: 0,
  }],
  totals: {
    goods_total: 2500,
    expenses_total: 0,
    grand_total: 2500,
    total_net_weight: 640,
    total_gross_weight: 840,
    total_places: 3,
  },
  signatureUrl: null,
  stampUrl: null,
  clientSignatureUrl: null,
  clientStampUrl: null,
}

const documents = [
  { fileName: 'customs-invoice.pdf', element: <InvoiceDocument data={data} /> },
  { fileName: 'customs-specification.pdf', element: <SpecificationDocument data={data} /> },
  { fileName: 'customs-packing-list.pdf', element: <PackingListDocument data={data} /> },
]

async function main() {
  const buffers = await Promise.all(documents.map((document) => renderToBuffer(document.element)))
  for (const [index, buffer] of buffers.entries()) {
    assert.ok(buffer.length > 1_000, `${documents[index].fileName} is unexpectedly small`)
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
  }

  const outputDirectory = process.env.CUSTOMS_PDF_QA_DIR
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true })
    await Promise.all(buffers.map((buffer, index) =>
      writeFile(path.join(outputDirectory, documents[index].fileName), buffer)))
  }
  console.log(`customs PDFs rendered: ${buffers.map((buffer) => buffer.length).join(', ')} bytes`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
