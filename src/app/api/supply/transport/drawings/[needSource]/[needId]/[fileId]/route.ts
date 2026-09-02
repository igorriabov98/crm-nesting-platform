import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'

const paramsSchema = z.object({
  needSource: z.enum(['outsourcing', 'detailing_transfer']),
  needId: z.string().uuid(),
  fileId: z.string().uuid(),
})

type ProductReference = {
  product_id: string | null
  product_version_id: string | null
}

type ProductFileRow = {
  id: string
  product_id: string
  product_version_id: string | null
  file_kind: string
  file_name: string
  file_path: string
  mime_type: string | null
}

function asIds(rows: Array<Record<string, unknown>>, key: string) {
  return rows.map((row) => row[key]).filter((value): value is string => typeof value === 'string')
}

async function loadOutsourcingReferences(
  admin: ReturnType<typeof createAdminClient>,
  needId: string,
): Promise<ProductReference[]> {
  const { data: needData } = await admin
    .from('machine_outsourcing_transport_needs')
    .select('operation_id')
    .eq('id', needId)
    .maybeSingle()
  const need = needData as { operation_id: string } | null
  if (!need?.operation_id) return []

  const [linksResult, vrbResult] = await Promise.all([
    admin
      .from('machine_outsourcing_operation_items')
      .select('machine_item_id')
      .eq('operation_id', need.operation_id),
    admin
      .from('machine_outsourcing_vrb_items')
      .select('source_machine_item_id, product_id')
      .eq('operation_id', need.operation_id),
  ])
  if (linksResult.error || vrbResult.error) return []
  const machineItemIds = Array.from(new Set([
    ...asIds((linksResult.data || []) as Array<Record<string, unknown>>, 'machine_item_id'),
    ...asIds((vrbResult.data || []) as Array<Record<string, unknown>>, 'source_machine_item_id'),
  ]))
  const { data: machineItems, error: machineItemsError } = machineItemIds.length > 0
    ? await admin
      .from('machine_items')
      .select('product_id, product_version_id')
      .in('id', machineItemIds)
    : { data: [], error: null }
  if (machineItemsError) return []

  return [
    ...((machineItems || []) as ProductReference[]),
    ...((vrbResult.data || []) as Array<{ product_id: string | null }>).map((item) => ({
      product_id: item.product_id,
      product_version_id: null,
    })),
  ]
}

async function loadDetailingReferences(
  admin: ReturnType<typeof createAdminClient>,
  transferId: string,
): Promise<ProductReference[]> {
  const { data: transferItems, error: transferItemsError } = await admin
    .from('detailing_transfer_items')
    .select('reservation_id')
    .eq('transfer_id', transferId)
  if (transferItemsError) return []
  const reservationIds = asIds((transferItems || []) as Array<Record<string, unknown>>, 'reservation_id')
  const { data: reservations, error: reservationsError } = reservationIds.length > 0
    ? await admin
      .from('detailing_reservations')
      .select('machine_item_id')
      .in('id', reservationIds)
    : { data: [], error: null }
  if (reservationsError) return []
  const machineItemIds = asIds((reservations || []) as Array<Record<string, unknown>>, 'machine_item_id')
  const { data: machineItems, error: machineItemsError } = machineItemIds.length > 0
    ? await admin
      .from('machine_items')
      .select('product_id, product_version_id')
      .in('id', machineItemIds)
    : { data: [], error: null }
  if (machineItemsError) return []
  return (machineItems || []) as ProductReference[]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ needSource: string; needId: string; fileId: string }> },
) {
  try {
    const parsed = paramsSchema.parse(await params)
    await requirePermission('supply_transport', 'view')
    const admin = createAdminClient()
    const { data: fileData, error: fileError } = await admin
      .from('product_files')
      .select('id, product_id, product_version_id, file_kind, file_name, file_path, mime_type')
      .eq('id', parsed.fileId)
      .maybeSingle()
    const file = fileData as ProductFileRow | null
    if (
      fileError
      || !file?.file_path
      || !file.product_id
      || !(file.file_kind === 'drawing' || file.file_kind === 'pdf' || file.file_name.toLowerCase().endsWith('.pdf'))
    ) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const references = parsed.needSource === 'outsourcing'
      ? await loadOutsourcingReferences(admin, parsed.needId)
      : await loadDetailingReferences(admin, parsed.needId)
    const productIds = Array.from(new Set(references.map((item) => item.product_id).filter((id): id is string => Boolean(id))))
    const { data: currentVersions, error: currentVersionsError } = productIds.length > 0
      ? await admin
        .from('product_versions')
        .select('id, product_id')
        .in('product_id', productIds)
        .eq('status', 'current')
      : { data: [], error: null }
    if (currentVersionsError) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const currentVersionByProduct = new Map(
      ((currentVersions || []) as Array<{ id: string; product_id: string }>).map((version) => [version.product_id, version.id]),
    )
    const belongsToNeed = references.some((reference) => {
      const productId = reference.product_id
      return Boolean(
        productId
        && productId === file.product_id
        && (
          reference.product_version_id === file.product_version_id
          || currentVersionByProduct.get(productId) === file.product_version_id
        ),
      )
    })
    if (!belongsToNeed) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    try {
      return await resolveFileResponse({
        bucket: 'product-files',
        objectPath: file.file_path,
        fileName: file.file_name,
        mimeType: file.mime_type,
      })
    } catch {
      return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
    }
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (error instanceof AuthRequiredError || error instanceof UserProfileMissingError || error instanceof UserInactiveError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
