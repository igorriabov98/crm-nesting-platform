import { AccessDenied } from '@/components/ui/AccessDenied'
import { ProductionFactSettingsPage } from '@/components/features/production/ProductionFactSettingsPage'
import { getProductionFactSettingsData } from '@/lib/actions/production-fact'

export const metadata = {
  title: 'Настройки факта производства - CRM Завода',
}

function isAccessError(error: unknown) {
  return error instanceof Error && error.message.includes('Недостаточно прав')
}

export default async function ProductionFactSettingsRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams

  try {
    const data = await getProductionFactSettingsData({ factoryId: params?.factory })
    return <ProductionFactSettingsPage data={data} />
  } catch (error) {
    if (isAccessError(error)) return <AccessDenied />
    throw error
  }
}
