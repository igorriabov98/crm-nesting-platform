import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTechnologistRequestAccess } from '@/lib/technologist-request-access'
import { getTechnologistApprovalDetail } from '@/lib/actions/technologist-request-approvals'

/* eslint-disable @typescript-eslint/no-explicit-any -- migration-backed report table */

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await context.params).id)
    const admin = createAdminClient() as any
    const { data: report, error } = await admin.from('technologist_pronest_reports')
      .select('request_id,storage_path,approval_version_id').eq('id', id).maybeSingle()
    if (error || !report) throw new Error('Отчёт не найден')
    if (report.approval_version_id) {
      const detail = await getTechnologistApprovalDetail(report.request_id)
      if (detail.error || !detail.data) throw new Error('Нет доступа к отчёту заявки')
    } else {
      await requireTechnologistRequestAccess(report.request_id, { workflowOperation: 'manage', inventoryOperation: 'manage', allowedStatuses: ['stock_checked'] })
    }
    const { data: signed, error: signError } = await admin.storage.from('nesting-files').createSignedUrl(report.storage_path, 60)
    if (signError || !signed) throw new Error('Не удалось открыть исходный PDF')
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Нет доступа к PDF' }, { status: 403 })
  }
}
