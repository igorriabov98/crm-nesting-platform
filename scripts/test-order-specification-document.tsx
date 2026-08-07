import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentData } from '../src/lib/actions/document-generation'
import {
  formatOrderSpecificationCoating,
  formatOrderSpecificationCoatingUk,
  OrderSpecificationDocument,
} from '../src/lib/pdf/OrderSpecificationDocument'

const data: DocumentData = {
  machine: {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Demo order',
    specification_number: 'ORD-2026-001',
    specification_date: '2026-07-31',
    packing_boxes_count: 0,
  },
  contract: null,
  client: {
    name: 'Example Industries GmbH',
    address: '',
    country_city: '',
    delivery_basis_location_en: '',
    delivery_basis_location_ua: '',
    director_name: '',
    signature_image_path: null,
    stamp_image_path: null,
  },
  company: {
    name_en: 'LEDA WEST LLC',
    name_ua: 'ТОВ «ЛЕДА ВЕСТ»',
    address_en: '',
    director_name_en: '',
    director_name_ua: '',
    enterprise_code: '',
    iban: '',
    swift: '',
    bank_name: '',
    bank_address: '',
    delivery_basis_en: '',
    delivery_basis_ua: '',
    intermediary_bank_name: '',
    intermediary_bank_swift: '',
    signature_image_path: null,
    stamp_image_path: null,
  },
  items: [
    {
      sort_order: 1,
      product_name_en: 'Tipping bucket for forklift truck AMC-600 WNA ECO RAL7016',
      product_name_uk: 'Ковш відкидний для вилкового автонавантажувача AMC-600 WNA ECO RAL7016',
      product_uktzed: '',
      quantity: 3,
      price: 125.5,
      total: 376.5,
      weight: 18.25,
      net_weight: 54.75,
      coating: 'powder_coating',
      ral_number: 'RAL 7016',
    },
    {
      sort_order: 2,
      product_name_en: 'Mounting frame for industrial equipment',
      product_name_uk: 'Монтажна рама для промислового обладнання',
      product_uktzed: '',
      quantity: 2,
      price: 80,
      total: 160,
      weight: 9.5,
      net_weight: 19,
      coating: 'zinc',
      ral_number: '',
    },
    {
      sort_order: 3,
      product_name_en: 'Cold zinc coated mounting plate',
      product_name_uk: 'Монтажна пластина з холодним цинком',
      product_uktzed: '',
      quantity: 1,
      price: 50,
      total: 50,
      weight: 4,
      net_weight: 4,
      coating: 'cold_zinc',
      ral_number: '',
    },
  ],
  expenses: [],
  packingGroups: [],
  totals: {
    goods_total: 586.5,
    expenses_total: 0,
    grand_total: 586.5,
    total_net_weight: 77.75,
    total_gross_weight: 77.75,
    total_places: 0,
  },
  signatureUrl: null,
  stampUrl: null,
  clientSignatureUrl: null,
  clientStampUrl: null,
}

async function main() {
  assert.equal(formatOrderSpecificationCoating(data.items[0]), 'Powder coating (RAL 7016)')
  assert.equal(formatOrderSpecificationCoating(data.items[1]), 'Hot-dip zinc coating')
  assert.equal(formatOrderSpecificationCoatingUk(data.items[1]), 'Гаряче цинкове покриття')
  assert.equal(formatOrderSpecificationCoating(data.items[2]), 'Cold zinc coating')
  assert.equal(formatOrderSpecificationCoatingUk(data.items[2]), 'Холодне цинкове покриття')

  const buffer = await renderToBuffer(<OrderSpecificationDocument data={data} />)
  assert.ok(buffer.length > 1_000, `Expected rendered PDF, received ${buffer.length} bytes`)

  const outputPath = process.env.ORDER_SPECIFICATION_OUTPUT
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, buffer)
  }

  console.log(`Order specification PDF rendered: ${buffer.length} bytes`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
