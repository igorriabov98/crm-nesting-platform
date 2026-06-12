import { notFound, redirect } from 'next/navigation'
import { NestingResultClient } from '@/components/features/nesting/NestingResultClient'
import { getProject, getResult } from '@/lib/nesting/api'
import type { NestingResult } from '@/lib/nesting/api'

export const metadata = { title: 'Результат раскладки — CRM Завода' }

export default async function NestingResultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let project
  try {
    const projectResult = await getProject(id)
    project = projectResult.data
  } catch {
    notFound()
  }

  if (project.status !== 'done') {
    redirect(`/nesting/${id}/parts`)
  }

  let result: NestingResult
  try {
    const resultResponse = await getResult(id)
    result = resultResponse.data
  } catch {
    notFound()
  }

  return <NestingResultClient project={project} result={result} />
}
