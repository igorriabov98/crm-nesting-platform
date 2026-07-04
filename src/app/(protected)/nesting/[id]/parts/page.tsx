import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NestingPartsClient } from '@/components/features/nesting/NestingPartsClient'
import { getProject, type NestingProject } from '@/lib/nesting/api'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getMachineItemNestingContext, type MachineItemNestingContext } from '@/lib/actions/machine-item-nesting'
import { assertCanAccessNestingProject } from '@/lib/nesting/project-access'
import type { SteelType } from '@/lib/types/database'

export const metadata = { title: 'Детали раскладки — CRM Завода' }

export default async function NestingPartsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let project: NestingProject
  let steelTypes: SteelType[]
  let machineContext: MachineItemNestingContext | null = null

  try {
    await assertCanAccessNestingProject(id, 'view')
    const [projectResult, steelTypesResult, nestingContextResult] = await Promise.all([
      getProject(id),
      getSteelTypes(),
      getMachineItemNestingContext(id),
    ])
    project = projectResult.data
    steelTypes = steelTypesResult
    machineContext = nestingContextResult.success ? nestingContextResult.data || null : null
  } catch (error) {
    return (
      <Card className="bg-white">
        <CardContent className="space-y-4">
          <p className="text-sm font-medium text-red-600">
            {error instanceof Error ? error.message : 'Проект раскладки не найден'}
          </p>
          <Link href="/nesting">
            <Button variant="outline">Назад к проектам</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return <NestingPartsClient project={project} steelTypes={steelTypes} machineContext={machineContext} />
}
