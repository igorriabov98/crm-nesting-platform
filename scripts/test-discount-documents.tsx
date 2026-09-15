import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentData } from '../src/lib/actions/document-generation'
import { InvoiceDocument } from '../src/lib/pdf/InvoiceDocument'
import { OrderSpecificationDocument } from '../src/lib/pdf/OrderSpecificationDocument'
import { SpecificationDocument } from '../src/lib/pdf/SpecificationDocument'

const data: DocumentData = {
  machine: {
    id: '72000000-0000-4000-8000-000000000001',
    name: 'Discount document test',
    specification_number: 'DISC-2026-001',
    specification_date: '2026-09-15',
    packing_boxes_count: 0,
  },
  contract: null,
  client: {
    name: 'Discount Client GmbH',
    address: 'Test address',
    country_city: 'Test city',
    delivery_basis_location_en: 'Test city',
    delivery_basis_location_ua: 'Тестове місто',
    director_name: 'Client Director',
    signature_image_path: null,
    stamp_image_path: null,
  },
  company: {
    name_en: 'LEDA WEST LLC',
    name_ua: 'ТОВ «ЛЕДА ВЕСТ»',
    address_en: 'Test address',
    director_name_en: 'Seller Director',
    director_name_ua: 'Директор продавця',
    enterprise_code: '00000000',
    iban: 'UA000000000000000000000000000',
    swift: 'TESTUA00',
    bank_name: 'Test bank',
    bank_address: 'Test bank address',
    delivery_basis_en: 'FCA Test city',
    delivery_basis_ua: 'FCA Тестове місто',
    intermediary_bank_name: '',
    intermediary_bank_swift: '',
    signature_image_path: null,
    stamp_image_path: null,
  },
  items: [{
    sort_order: 1,
    product_name_en: 'Discounted product',
    product_name_uk: 'Товар зі знижкою',
    product_uktzed: '7308',
    quantity: 3,
    price: 195.5,
    total: 586.5,
    weight: 10,
    net_weight: 30,
    coating: 'none',
    ral_number: '',
  }],
  expenses: [
    { category: 'transport', label: 'Transport', comment: '', amount: 60 },
    { category: 'other', label: 'Packaging', comment: '', amount: 5.55 },
  ],
  packingGroups: [],
  totals: {
    goods_total: 586.5,
    discount_percent: 10,
    discount_amount: 58.65,
    goods_total_after_discount: 527.85,
    total_before_discount: 652.05,
    expenses_total: 65.55,
    grand_total: 593.4,
    total_net_weight: 30,
    total_gross_weight: 30,
    total_places: 0,
  },
  signatureUrl: null,
  stampUrl: null,
  clientSignatureUrl: null,
  clientStampUrl: null,
}

const documents = [
  ['specification', <SpecificationDocument key="specification" data={data} />],
  ['order-specification', <OrderSpecificationDocument key="order-specification" data={data} />],
  ['invoice', <InvoiceDocument key="invoice" data={data} />],
] as const
const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))

async function main() {
  for (const [name, document] of documents) {
    const buffer = await renderToBuffer(document)
    assert.ok(buffer.length > 1_000, `${name} PDF was unexpectedly small`)
    const pdf = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl }).promise
    let text = ''
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      text += content.items.map((item) => 'str' in item ? item.str : '').join(' ')
    }
    const normalizedText = text.replace(/\s+/g, ' ')
    assert.match(normalizedText, /Goods total \/ Сума товарів/)
    assert.match(normalizedText, /Discount \/ Знижка 10 ?%/)
    assert.match(normalizedText, /Goods after discount \/ Товари зі знижкою/)
    assert.match(normalizedText, /58[,.]65/)
    assert.match(normalizedText, /527[,.]85/)
    assert.match(normalizedText, /593[,.]40/)
  }
  console.log('discount specification, order specification, and invoice PDFs: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
