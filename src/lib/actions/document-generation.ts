import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

type MachineRow = Pick<
  Database['public']['Tables']['machines']['Row'],
  | 'id'
  | 'name'
  | 'specification_number'
  | 'specification_date'
  | 'packing_gross_weight_kg'
  | 'packing_net_weight_kg'
  | 'packing_summary_en'
  | 'packing_summary_ua'
>
type ContractRow = Pick<Database['public']['Tables']['contracts']['Row'], 'number' | 'date'>
type ClientRow = Pick<
  Database['public']['Tables']['clients']['Row'],
  | 'name'
  | 'address'
  | 'country_city'
  | 'delivery_basis_location_en'
  | 'delivery_basis_location_ua'
  | 'director_name'
  | 'second_director_name'
  | 'second_director_name_en'
  | 'second_director_name_ua'
  | 'signature_image_path'
  | 'stamp_image_path'
>
type CompanyRow = Pick<
  Database['public']['Tables']['company_settings']['Row'],
  | 'name_en'
  | 'name_ua'
  | 'address_en'
  | 'address_ua'
  | 'director_name_en'
  | 'director_name_ua'
  | 'enterprise_code'
  | 'iban'
  | 'swift'
  | 'bank_name'
  | 'bank_address'
  | 'delivery_basis_en'
  | 'delivery_basis_ua'
  | 'intermediary_bank_name'
  | 'intermediary_bank_swift'
  | 'signature_image_path'
  | 'stamp_image_path'
>
type MachineItemRow = Pick<
  Database['public']['Tables']['machine_items']['Row'],
  | 'sort_order'
  | 'product_name'
  | 'product_name_en'
  | 'product_name_uk'
  | 'product_uktzed'
  | 'quantity'
  | 'price'
  | 'weight'
  | 'net_weight'
  | 'packing_type'
  | 'packing_places'
  | 'coating'
  | 'ral_number'
  | 'is_sample'
>
type MachineExpenseRow = Pick<
  Database['public']['Tables']['machine_expenses']['Row'],
  'category' | 'amount' | 'comment'
>
type MachinePackingGroupRow = Pick<
  Database['public']['Tables']['machine_packing_groups']['Row'],
  | 'start_item_number'
  | 'end_item_number'
  | 'packing_type_en'
  | 'packing_type_ua'
  | 'places'
  | 'sort_order'
>

type MaybeArray<T> = T | T[] | null

type MachineDocumentRow = MachineRow & {
  client: MaybeArray<ClientRow>
  contract: MaybeArray<ContractRow>
  machine_items: MachineItemRow[] | null
  machine_expenses: MachineExpenseRow[] | null
  machine_packing_groups: MachinePackingGroupRow[] | null
}

export type DocumentItem = {
  sort_order: number
  product_name_en: string
  product_name_uk: string
  product_uktzed: string
  quantity: number
  price: number
  total: number
  weight: number
  net_weight: number
  packing_type: string
  packing_places: number
  coating: Database['public']['Enums']['coating_type']
  ral_number: string
}

export type DocumentExpense = {
  category: string
  comment: string
  label: string
  amount: number
}

export type DocumentPackingGroup = {
  start_item_number: number
  end_item_number: number
  packing_type_en: string
  packing_type_ua: string
  places: number
  sort_order: number
}

export type DocumentData = {
  machine: {
    id: string
    name: string
    specification_number: string
    specification_date: string
    packing_gross_weight_kg: number | null
    packing_net_weight_kg: number | null
    packing_summary_en: string
    packing_summary_ua: string
  }
  contract: {
    number: string
    date: string
  } | null
  client: {
    name: string
    address: string
    country_city: string
    delivery_basis_location_en: string
    delivery_basis_location_ua: string
    director_name: string
    second_director_name: string
    second_director_name_en: string
    second_director_name_ua: string
    signature_image_path: string | null
    stamp_image_path: string | null
  }
  company: {
    name_en: string
    name_ua: string
    address_en: string
    address_ua: string
    director_name_en: string
    director_name_ua: string
    enterprise_code: string
    iban: string
    swift: string
    bank_name: string
    bank_address: string
    delivery_basis_en: string
    delivery_basis_ua: string
    intermediary_bank_name: string
    intermediary_bank_swift: string
    signature_image_path: string | null
    stamp_image_path: string | null
  }
  items: DocumentItem[]
  expenses: DocumentExpense[]
  packingGroups: DocumentPackingGroup[]
  totals: {
    goods_total: number
    expenses_total: number
    grand_total: number
    total_net_weight: number
    total_gross_weight: number
    total_places: number
  }
  signatureUrl: string | null
  stampUrl: string | null
  clientSignatureUrl: string | null
  clientStampUrl: string | null
}

const FALLBACK_COMPANY = {
  name_en: 'LEDA WEST LLC',
  name_ua: 'ТОВ «ЛЕДА ВЕСТ»',
  address_en: '90200, Berehovo, Bohdana Khmelnytskyi Str. 112, Ukraine',
  address_ua: '90200, м. Берегове, вул. Богдана Хмельницького, 112, Україна',
  director_name_en: 'R. Choufany',
  director_name_ua: 'Р. Шуфані',
  enterprise_code: '44794546',
  iban: 'UA233510050000026000879148879',
  swift: 'KHABUA2K',
  bank_name: 'JOINT STOCK COMPANY "UKRSIBBANK"',
  bank_address: '07205696, JSC "UKRSIBBANK", Andriivska str. 2/12, Kyiv, Ukraine',
  delivery_basis_en: 'Delivery Basis: DAP',
  delivery_basis_ua: 'Базис постачання: DAP',
  intermediary_bank_name: 'BNP PARIBAS SA Paris, France',
  intermediary_bank_swift: 'BNPAFRPP',
} satisfies Omit<DocumentData['company'], 'signature_image_path' | 'stamp_image_path'>

type LooseQueryResult = { data: unknown; error: { message?: string } | null }
type LooseSingleQuery = {
  select: (columns?: string) => LooseSingleQuery
  eq: (column: string, value: unknown) => LooseSingleQuery
  single: () => Promise<LooseQueryResult>
}
type LooseDb = {
  from: (table: string) => LooseSingleQuery
}
type SupabaseStorageClient = Pick<Awaited<ReturnType<typeof createServerSupabaseClient>>, 'storage'>

const machineIdSchema = z.string().uuid('Некорректный ID заказа')

function dbFrom(supabase: unknown): LooseDb {
  return supabase as LooseDb
}

function clean(value: string | null | undefined) {
  return value?.trim() || ''
}

function companyValue<K extends keyof typeof FALLBACK_COMPANY>(company: CompanyRow, key: K) {
  return clean(company[key]) || FALLBACK_COMPANY[key]
}

function firstOrNull<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

async function createSignedImageUrl(
  supabase: SupabaseStorageClient,
  path: string | null
) {
  if (!path) return null

  const { data, error } = await supabase.storage
    .from('product-files')
    .createSignedUrl(path, 3600)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function getDocumentData(machineId: string): Promise<DocumentData> {
  const parsedMachineId = machineIdSchema.parse(machineId)
  const supabase = await createServerSupabaseClient()
  const sessionDb = dbFrom(supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: visibleMachine, error: visibilityError } = await sessionDb
    .from('machines')
    .select('id')
    .eq('id', parsedMachineId)
    .single()

  if (visibilityError || !visibleMachine) {
    throw new Error(visibilityError?.message || 'Заказ не найден')
  }

  const adminSupabase = createAdminClient()
  const db = dbFrom(adminSupabase)

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select(`
      id,
      name,
      specification_number,
      specification_date,
      packing_gross_weight_kg,
      packing_net_weight_kg,
      packing_summary_en,
      packing_summary_ua,
      client:clients(
        name,
        address,
        country_city,
        delivery_basis_location_en,
        delivery_basis_location_ua,
        director_name,
        second_director_name,
        second_director_name_en,
        second_director_name_ua,
        signature_image_path,
        stamp_image_path
      ),
      contract:contracts(number, date),
      machine_items(
        sort_order,
        product_name,
        product_name_en,
        product_name_uk,
        product_uktzed,
        quantity,
        price,
        weight,
        net_weight,
        packing_type,
        packing_places,
        coating,
        ral_number,
        is_sample
      ),
      machine_expenses(
        category,
        amount,
        comment
      ),
      machine_packing_groups(
        start_item_number,
        end_item_number,
        packing_type_en,
        packing_type_ua,
        places,
        sort_order
      )
    `)
    .eq('id', parsedMachineId)
    .single()

  if (machineError || !machineData) {
    throw new Error(machineError?.message || 'Заказ не найден')
  }

  const machine = machineData as MachineDocumentRow
  const client = firstOrNull(machine.client)
  if (!client) throw new Error('У заказа не указан клиент')

  const goodsRows = (machine.machine_items || [])
    .filter((item) => !item.is_sample)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  if (goodsRows.length === 0) {
    throw new Error('В заказе нет товарных позиций для документов')
  }

  const { data: companyData, error: companyError } = await db
    .from('company_settings')
    .select(`
      name_en,
      name_ua,
      address_en,
      address_ua,
      director_name_en,
      director_name_ua,
      enterprise_code,
      iban,
      swift,
      bank_name,
      bank_address,
      delivery_basis_en,
      delivery_basis_ua,
      intermediary_bank_name,
      intermediary_bank_swift,
      signature_image_path,
      stamp_image_path
    `)
    .eq('id', COMPANY_SETTINGS_ID)
    .single()

  if (companyError || !companyData) {
    throw new Error(companyError?.message || 'Настройки компании не найдены')
  }

  const company = companyData as CompanyRow

  const items: DocumentItem[] = goodsRows.map((item) => {
    const quantity = toNumber(item.quantity)
    const price = toNumber(item.price)
    const weight = toNumber(item.weight)
    const netWeight = item.net_weight === null || item.net_weight === undefined
      ? weight * quantity
      : toNumber(item.net_weight)

    return {
      sort_order: item.sort_order || 0,
      product_name_en: clean(item.product_name_en) || clean(item.product_name),
      product_name_uk: clean(item.product_name_uk) || clean(item.product_name),
      product_uktzed: clean(item.product_uktzed),
      quantity,
      price,
      total: quantity * price,
      weight,
      net_weight: netWeight,
      packing_type: clean(item.packing_type),
      packing_places: Math.max(0, Math.trunc(toNumber(item.packing_places))),
      coating: item.coating,
      ral_number: clean(item.ral_number),
    }
  })
  const expenses: DocumentExpense[] = (machine.machine_expenses || [])
    .map((expense) => {
      const amount = toNumber(expense.amount)
      const category = clean(expense.category)
      const comment = clean(expense.comment)
      const label = [category, comment].filter(Boolean).join(' - ')

      return {
        category,
        comment,
        label: label || 'Additional expenses',
        amount,
      }
    })
    .filter((expense) => expense.amount > 0)
  const packingGroups: DocumentPackingGroup[] = (machine.machine_packing_groups || [])
    .map((group) => ({
      start_item_number: Math.max(1, Math.trunc(toNumber(group.start_item_number))),
      end_item_number: Math.max(1, Math.trunc(toNumber(group.end_item_number))),
      packing_type_en: clean(group.packing_type_en),
      packing_type_ua: clean(group.packing_type_ua),
      places: Math.max(1, Math.trunc(toNumber(group.places))),
      sort_order: Math.trunc(toNumber(group.sort_order)),
    }))
    .filter((group) => group.packing_type_en && group.end_item_number >= group.start_item_number)
    .sort((a, b) => {
      const byOrder = a.sort_order - b.sort_order
      return byOrder || a.start_item_number - b.start_item_number
    })

  const goodsTotal = items.reduce((sum, item) => sum + item.total, 0)
  const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const totalNetWeight = items.reduce((sum, item) => sum + item.net_weight, 0)
  const totalPlaces = items.reduce((sum, item) => sum + item.packing_places, 0)
  const [signatureUrl, stampUrl, clientSignatureUrl, clientStampUrl] = await Promise.all([
    createSignedImageUrl(adminSupabase, company.signature_image_path),
    createSignedImageUrl(adminSupabase, company.stamp_image_path),
    createSignedImageUrl(adminSupabase, client.signature_image_path),
    createSignedImageUrl(adminSupabase, client.stamp_image_path),
  ])

  return {
    machine: {
      id: machine.id,
      name: clean(machine.name),
      specification_number: clean(machine.specification_number),
      specification_date: clean(machine.specification_date),
      packing_gross_weight_kg: machine.packing_gross_weight_kg === null || machine.packing_gross_weight_kg === undefined
        ? null
        : toNumber(machine.packing_gross_weight_kg),
      packing_net_weight_kg: machine.packing_net_weight_kg === null || machine.packing_net_weight_kg === undefined
        ? null
        : toNumber(machine.packing_net_weight_kg),
      packing_summary_en: clean(machine.packing_summary_en),
      packing_summary_ua: clean(machine.packing_summary_ua),
    },
    contract: firstOrNull(machine.contract)
      ? {
          number: clean(firstOrNull(machine.contract)?.number),
          date: clean(firstOrNull(machine.contract)?.date),
        }
      : null,
    client: {
      name: clean(client.name),
      address: clean(client.address),
      country_city: clean(client.country_city),
      delivery_basis_location_en: clean(client.delivery_basis_location_en),
      delivery_basis_location_ua: clean(client.delivery_basis_location_ua),
      director_name: clean(client.director_name),
      second_director_name: clean(client.second_director_name),
      second_director_name_en: clean(client.second_director_name_en),
      second_director_name_ua: clean(client.second_director_name_ua),
      signature_image_path: client.signature_image_path,
      stamp_image_path: client.stamp_image_path,
    },
    company: {
      name_en: companyValue(company, 'name_en'),
      name_ua: companyValue(company, 'name_ua'),
      address_en: companyValue(company, 'address_en'),
      address_ua: companyValue(company, 'address_ua'),
      director_name_en: companyValue(company, 'director_name_en'),
      director_name_ua: companyValue(company, 'director_name_ua'),
      enterprise_code: companyValue(company, 'enterprise_code'),
      iban: companyValue(company, 'iban'),
      swift: companyValue(company, 'swift'),
      bank_name: companyValue(company, 'bank_name'),
      bank_address: companyValue(company, 'bank_address'),
      delivery_basis_en: companyValue(company, 'delivery_basis_en'),
      delivery_basis_ua: companyValue(company, 'delivery_basis_ua'),
      intermediary_bank_name: companyValue(company, 'intermediary_bank_name'),
      intermediary_bank_swift: companyValue(company, 'intermediary_bank_swift'),
      signature_image_path: company.signature_image_path,
      stamp_image_path: company.stamp_image_path,
    },
    items,
    expenses,
    packingGroups,
    totals: {
      goods_total: goodsTotal,
      expenses_total: expensesTotal,
      grand_total: goodsTotal + expensesTotal,
      total_net_weight: totalNetWeight,
      total_gross_weight: totalNetWeight * 1.02,
      total_places: totalPlaces,
    },
    signatureUrl,
    stampUrl,
    clientSignatureUrl,
    clientStampUrl,
  }
}
