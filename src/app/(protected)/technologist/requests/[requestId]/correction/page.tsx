import { withPagePermission } from '@/lib/permissions/page-guard'
import { getCompletionCorrectionWorkspace } from '@/lib/actions/request-completion'
import { RequestCompletionCorrection } from '@/components/features/technologist/RequestCompletionCorrection'

async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params; const result = await getCompletionCorrectionWorkspace(requestId)
  if (!result.data) return <p className="text-destructive">{result.error}</p>
  return <RequestCompletionCorrection requestId={requestId} data={result.data} />
}


export default withPagePermission('/technologist/requests/sample-id/correction', Page)
