import { MailPageClient } from '@/components/features/mail/MailPageClient'
import { getMailAccountStatus, getMailLabels, getMailThreads } from '@/lib/actions/mail'

export const metadata = { title: 'Почта — CRM Завода' }

export default async function MailPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const [status, params] = await Promise.all([getMailAccountStatus(), searchParams])
  const labels = status.connected ? await getMailLabels() : []
  const initial = status.connected
    ? await getMailThreads({ folder: 'INBOX' })
    : { items: [], nextCursor: null, hasMore: false }
  return <MailPageClient status={status} initial={initial} initialThreadId={params.thread || null} labels={labels} />
}
