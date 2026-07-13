import type { DocumentItem } from '@/lib/actions/document-generation'

type ItemGroup = {
  uktzed: string
  items: DocumentItem[]
}

type DocumentItemLanguage = 'en' | 'uk'

const TRAILING_RAL_CODE_PATTERN = /\s*\(?RAL\s*[-:]?\s*\d{4}\)?\s*$/i

function withoutTrailingRalCode(value: string) {
  return value.trim().replace(TRAILING_RAL_CODE_PATTERN, '').trim()
}

function documentRalLabel(item: DocumentItem) {
  if (item.coating !== 'powder_coating') return ''

  const code = item.ral_number
    .trim()
    .replace(/^RAL\s*[-:]?\s*/i, '')
    .replace(/\s+/g, '')

  return code ? `RAL${code.toUpperCase()}` : ''
}

export function formatDocumentItemName(item: DocumentItem, language: DocumentItemLanguage) {
  const sourceName = language === 'en'
    ? item.product_name_en || item.product_name_uk || 'Item'
    : item.product_name_uk || item.product_name_en || 'Товар'
  const baseName = withoutTrailingRalCode(sourceName)

  return [baseName, documentRalLabel(item)].filter(Boolean).join(' ')
}

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const EN_SCALES = ['', 'thousand', 'million', 'billion']

const UA_HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"]
const UA_TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"]
const UA_TEENS = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять", 'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"]
const UA_ONES_MALE = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"]
const UA_ONES_FEMALE = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"]

export function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const datePart = value.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!match) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function formatMoney(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const sign = safeValue < 0 ? '-' : ''
  const [whole, fraction] = Math.abs(safeValue).toFixed(2).split('.')
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`
}

export function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : formatMoney(value)
}

export function formatWeight(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  return safeValue.toFixed(3).replace(/\.?0+$/, '')
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value
}

function englishUnderThousand(value: number): string {
  const parts: string[] = []
  const hundreds = Math.floor(value / 100)
  const rest = value % 100

  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`)
  if (rest < 20) {
    if (rest) parts.push(EN_ONES[rest])
  } else {
    const tens = Math.floor(rest / 10)
    const ones = rest % 10
    parts.push(ones ? `${EN_TENS[tens]}-${EN_ONES[ones]}` : EN_TENS[tens])
  }

  return parts.join(' ')
}

export function numberToWordsEn(value: number) {
  const integer = Math.max(0, Math.floor(Math.abs(value)))
  if (integer === 0) return EN_ONES[0]

  const chunks: string[] = []
  let remaining = integer
  let scale = 0

  while (remaining > 0) {
    const chunk = remaining % 1000
    if (chunk) {
      const scaleWord = EN_SCALES[scale]
      chunks.unshift(`${englishUnderThousand(chunk)}${scaleWord ? ` ${scaleWord}` : ''}`)
    }
    remaining = Math.floor(remaining / 1000)
    scale += 1
  }

  return chunks.join(' ')
}

function uaPlural(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100
  const last = value % 10
  if (lastTwo >= 11 && lastTwo <= 14) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function ukrainianUnderThousand(value: number, feminine: boolean) {
  const words: string[] = []
  const hundreds = Math.floor(value / 100)
  const tensValue = value % 100
  const ones = value % 10
  const onesWords = feminine ? UA_ONES_FEMALE : UA_ONES_MALE

  if (hundreds) words.push(UA_HUNDREDS[hundreds])
  if (tensValue >= 10 && tensValue <= 19) {
    words.push(UA_TEENS[tensValue - 10])
  } else {
    const tens = Math.floor(tensValue / 10)
    if (tens) words.push(UA_TENS[tens])
    if (ones) words.push(onesWords[ones])
  }

  return words.join(' ')
}

export function numberToWordsUa(value: number) {
  const integer = Math.max(0, Math.floor(Math.abs(value)))
  if (integer === 0) return 'нуль'

  const groups = [
    { one: '', few: '', many: '', feminine: false },
    { one: 'тисяча', few: 'тисячі', many: 'тисяч', feminine: true },
    { one: 'мільйон', few: 'мільйони', many: 'мільйонів', feminine: false },
    { one: 'мільярд', few: 'мільярди', many: 'мільярдів', feminine: false },
  ]
  const parts: string[] = []
  let remaining = integer
  let groupIndex = 0

  while (remaining > 0) {
    const chunk = remaining % 1000
    const group = groups[groupIndex]
    if (chunk && group) {
      const words = ukrainianUnderThousand(chunk, group.feminine)
      const label = groupIndex === 0 ? '' : uaPlural(chunk, group.one, group.few, group.many)
      parts.unshift([words, label].filter(Boolean).join(' '))
    }
    remaining = Math.floor(remaining / 1000)
    groupIndex += 1
  }

  return parts.join(' ')
}

export function amountToWordsEn(value: number) {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 100)
  const euros = Math.floor(rounded / 100)
  const cents = rounded % 100
  const centWord = cents === 1 ? 'eurocent' : 'eurocents'
  return `${capitalize(numberToWordsEn(euros))} euros and ${numberToWordsEn(cents)} ${centWord}.`
}

export function amountToWordsUa(value: number) {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 100)
  const absoluteRounded = Math.abs(rounded)
  const euros = Math.floor(absoluteRounded / 100)
  const cents = absoluteRounded % 100
  const centWord = uaPlural(cents, 'євроцент', 'євроценти', 'євроцентів')

  return `${capitalize(numberToWordsUa(euros))} євро і ${numberToWordsUa(cents)} ${centWord}`
}

export function groupItemsByHsCode(items: DocumentItem[]): ItemGroup[] {
  const groups: ItemGroup[] = []

  for (const item of items) {
    const uktzed = item.product_uktzed || '-'
    const current = groups.find((group) => group.uktzed === uktzed)
    if (current) {
      current.items.push(item)
    } else {
      groups.push({ uktzed, items: [item] })
    }
  }

  return groups
}
