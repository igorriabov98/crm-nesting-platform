import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NestingResultClient } from '@/components/features/nesting/NestingResultClient'
import { getFutureFillContext } from '@/lib/actions/nesting-future-fill'
import { getProject, getResult } from '@/lib/nesting/api'
import type { NestingResult } from '@/lib/nesting/api'
import { assertCanAccessNestingProject } from '@/lib/nesting/project-access'
import { isCompletedNestingStatus } from '@/lib/nesting/status'

export const metadata = { title: 'Результат раскладки — CRM Завода' }

export default async function NestingResultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let project
  try {
    await assertCanAccessNestingProject(id, 'view')
    const projectResult = await getProject(id)
    project = projectResult.data
  } catch (error) {
    return <ResultErrorCard message={error instanceof Error ? error.message : 'Проект раскладки не найден'} />
  }

  if (!isCompletedNestingStatus(project.status)) {
    redirect(`/nesting/${id}/parts`)
  }

  let result: NestingResult
  try {
    const resultResponse = await getResult(id)
    result = resultResponse.data
  } catch (error) {
    return <ResultErrorCard message={error instanceof Error ? error.message : 'Не удалось загрузить результат раскладки'} />
  }

  const futureFillContext = await getFutureFillContext(id)

  return <NestingResultClient project={project} result={result} futureFillContext={futureFillContext.data || null} />
}

function ResultErrorCard({ message }: { message: string }) {
  return (
    <Card className="bg-white">
      <CardContent className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
        <div className="space-y-3">
          <div>
            <p className="font-medium text-red-700">Результат раскладки недоступен</p>
            <p className="mt-1 text-sm text-[#6B7280]">{message}</p>
          </div>
          <Link href="/nesting">
            <Button variant="outline">Назад к проектам</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
