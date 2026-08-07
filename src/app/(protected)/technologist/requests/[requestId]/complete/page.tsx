import { notFound, redirect } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getCompletionWorkspace } from '@/lib/actions/request-completion'
import { RequestCompletionWizard } from '@/components/features/technologist/RequestCompletionWizard'

export default async function RequestCompletionPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const result = await getCompletionWorkspace(requestId)
  if (result.redirectTo) redirect(result.redirectTo)
  if (!result.data) {
    if (result.error === 'Заявка не найдена') notFound()
    return <Alert variant="destructive"><AlertTitle>Мастер недоступен</AlertTitle><AlertDescription>{result.error}</AlertDescription></Alert>
  }
  return <RequestCompletionWizard workspace={result.data} />
}
