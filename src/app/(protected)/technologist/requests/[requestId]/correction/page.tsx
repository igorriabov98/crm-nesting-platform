import { getCompletionCorrectionWorkspace } from '@/lib/actions/request-completion'
import { RequestCompletionCorrection } from '@/components/features/technologist/RequestCompletionCorrection'

export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params; const result = await getCompletionCorrectionWorkspace(requestId)
  if (!result.data) return <p className="text-destructive">{result.error}</p>
  return <RequestCompletionCorrection requestId={requestId} data={result.data} />
}

