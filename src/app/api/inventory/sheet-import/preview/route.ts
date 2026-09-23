import { sheetImportUploadResponse } from '@/lib/inventory/sheet-import-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) { return sheetImportUploadResponse(request, false) }
