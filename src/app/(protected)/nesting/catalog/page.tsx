import type React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CatalogTabsShell, type CatalogTab } from '@/components/features/nesting/catalog/CatalogTabsShell'
import { SheetsCatalogTab } from '@/components/features/nesting/catalog/SheetsCatalogTab'
import { GapsCatalogTab } from '@/components/features/nesting/catalog/GapsCatalogTab'
import { KFactorsCatalogTab } from '@/components/features/nesting/catalog/KFactorsCatalogTab'
import { RemnantsCatalogTab } from '@/components/features/nesting/catalog/RemnantsCatalogTab'
import {
  getGaps,
  getKFactors,
  getRemnants,
  getSheetThicknessOptions,
  getSheets,
} from '@/lib/nesting/catalog-api'

export const metadata = { title: 'Справочники раскладки — CRM Завода' }

const tabs: CatalogTab[] = ['sheets', 'gaps', 'kfactors', 'remnants']
const materials = ['Сталь', 'Нержавейка', 'Алюминий']

type CatalogSearchParams = {
  tab?: string
  material?: string
  thickness?: string
  page?: string
  availableOnly?: string
}

function parseTab(value?: string): CatalogTab {
  return tabs.includes(value as CatalogTab) ? value as CatalogTab : 'sheets'
}

function parseMaterial(value?: string) {
  return value && materials.includes(value) ? value : undefined
}

function parsePositiveNumber(value?: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parsePage(value?: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function CatalogError({ message }: { message: string }) {
  return (
    <Card className="bg-white">
      <CardContent>
        <p className="text-sm font-medium text-red-600">{message}</p>
      </CardContent>
    </Card>
  )
}

export default async function NestingCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<CatalogSearchParams>
}) {
  const params = await searchParams
  const activeTab = parseTab(params?.tab)
  const material = parseMaterial(params?.material)
  const thickness = parsePositiveNumber(params?.thickness)
  const page = parsePage(params?.page)
  const availableOnly = params?.availableOnly !== 'false'

  try {
    let content: React.ReactNode

    if (activeTab === 'sheets') {
      const [result, thicknessOptions] = await Promise.all([
        getSheets({ material, thickness, page, limit: 20 }),
        getSheetThicknessOptions({ material }),
      ])
      content = (
        <SheetsCatalogTab
          result={result}
          material={material}
          thickness={thickness}
          thicknessOptions={thicknessOptions}
        />
      )
    } else if (activeTab === 'gaps') {
      const result = await getGaps(material)
      content = <GapsCatalogTab items={result.data} material={material} />
    } else if (activeTab === 'kfactors') {
      const result = await getKFactors(material)
      content = <KFactorsCatalogTab items={result.data} material={material} />
    } else {
      const result = await getRemnants({ material, thickness, availableOnly })
      content = (
        <RemnantsCatalogTab
          items={result.data}
          material={material}
          thickness={thickness}
          availableOnly={availableOnly}
        />
      )
    }

    return (
      <CatalogTabsShell activeTab={activeTab}>
        {content}
      </CatalogTabsShell>
    )
  } catch (error) {
    return (
      <CatalogTabsShell activeTab={activeTab}>
        <CatalogError message={error instanceof Error ? error.message : 'Не удалось загрузить справочники'} />
      </CatalogTabsShell>
    )
  }
}
