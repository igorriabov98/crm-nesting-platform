'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, CheckCircle2, Eye, FileText, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingButton } from '@/components/ui/loading-button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/features/nesting/StatusBadge'
import { StatsCards } from '@/components/features/nesting/StatsCards'
import { PartsTable } from '@/components/features/nesting/PartsTable'
import { StrategySelector } from '@/components/features/nesting/StrategySelector'
import { AIAnalysisPanel } from '@/components/features/nesting/AIAnalysisPanel'
import { useProjectPolling } from '@/hooks/use-project-polling'
import { getNestingParts, startNestingCalculation } from '@/lib/nesting/actions'
import { importMachineItemNestingResult, type MachineItemNestingContext } from '@/lib/actions/machine-item-nesting'
import { syncNestingBatchProjectStatus } from '@/lib/actions/nesting-batches'
import type { SteelType } from '@/lib/types/database'
import type { NestingPart, NestingProject, NestingStatus, NestingStrategy } from '@/lib/nesting/api'
import { isCompletedNestingStatus } from '@/lib/nesting/status'

const validStrategies = ['minWaste', 'remnant', 'minSheets']

function PartsSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-[#E8ECF0] bg-white p-4">
      <div className="flex items-center gap-3 text-sm text-[#6B7280]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Парсинг STEP-файла...
      </div>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function NestingPartsClient({
  project,
  steelTypes,
  machineContext = null,
}: {
  project: NestingProject
  steelTypes: SteelType[]
  machineContext?: MachineItemNestingContext | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<NestingStatus | string>(project.status)
  const [parts, setParts] = useState<NestingPart[]>([])
  const [isLoadingParts, setIsLoadingParts] = useState(false)
  const [partsError, setPartsError] = useState<string | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [strategy, setStrategy] = useState<NestingStrategy>(
    validStrategies.includes(project.strategy) ? project.strategy as NestingStrategy : 'minWaste'
  )

  const shouldPoll = ['created', 'parsing', 'calculating'].includes(status)
  const pollingTargets = status === 'calculating' ? ['done', 'completed_with_warnings', 'error'] : ['parsed', 'error']
  const { errorMessage } = useProjectPolling(project.id, pollingTargets, 2000, shouldPoll, {
    onStatusChange: (nextStatus) => {
      setStatus(nextStatus)
    },
    onTargetStatus: (nextStatus, payload) => {
      setStatus(nextStatus)

      if (isCompletedNestingStatus(nextStatus)) {
        void syncNestingBatchProjectStatus(project.id)
        setIsCalculating(false)
        if (machineContext) {
          toast.success('Расчет готов. Можно импортировать листы в заявку технолога.')
        } else {
          router.replace(`/nesting/${project.id}/result`)
        }
        return
      }

      if (nextStatus === 'error') {
        void syncNestingBatchProjectStatus(project.id)
        setIsCalculating(false)
        toast.error(payload.errorMessage || 'Ошибка расчёта раскладки')
      }
    },
    onError: (message) => {
      setIsCalculating(false)
      toast.error(message)
    },
  })

  const sheetMetalCount = useMemo(
    () => parts.filter((part) => part.isActive !== false && (part.partType === 'SHEET' || (!part.partType && part.isSheetMetal))).length,
    [parts]
  )

  const loadParts = useCallback(async () => {
    setIsLoadingParts(true)
    setPartsError(null)
    try {
      const result = await getNestingParts(project.id)
      setParts(result.data)
    } catch (error) {
      setPartsError(error instanceof Error ? error.message : 'Не удалось загрузить детали')
    } finally {
      setIsLoadingParts(false)
    }
  }, [project.id])

  useEffect(() => {
    if ((status === 'parsed' || isCompletedNestingStatus(status)) && parts.length === 0 && !isLoadingParts) {
      loadParts()
    }
  }, [status, parts.length, isLoadingParts, loadParts])

  async function handleStartCalculation() {
    setIsCalculating(true)
    try {
      const result = await startNestingCalculation(project.id, strategy)
      setStatus(result.data.status || 'calculating')
      toast.success('Расчёт запущен')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось запустить расчёт')
    } finally {
      setIsCalculating(false)
    }
  }

  async function handleImportResult() {
    setIsImporting(true)
    try {
      const result = await importMachineItemNestingResult(project.id)
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось импортировать листы в заявку')
        return
      }
      toast.success(`Импортировано строк: ${result.data.rowsInserted}`)
      router.push(`/sales-plan/${result.data.machineId}/request/${result.data.requestId}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось импортировать листы в заявку')
    } finally {
      setIsImporting(false)
    }
  }

  function handleViewResult() {
    router.push(`/nesting/${project.id}/result`)
  }

  if (status === 'error') {
    return (
      <div className="space-y-4">
        <Header project={project} status={status} />
        <Card className="bg-white">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-700">Ошибка обработки проекта</p>
              <p className="mt-1 text-sm text-[#6B7280]">{errorMessage || project.errorMessage || 'Подробности ошибки не переданы.'}</p>
              <Link href="/nesting">
                <Button className="mt-4" variant="outline">Назад к проектам</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Header project={project} status={status} />
      {machineContext && (
        <MachineNestingContextCard
          context={machineContext}
          status={status}
          isImporting={isImporting}
          onImport={handleImportResult}
        />
      )}

      {status === 'created' || status === 'parsing' ? (
        <PartsSkeleton />
      ) : (
        <>
          {isLoadingParts ? <PartsSkeleton /> : partsError ? (
            <Card className="bg-white">
              <CardContent className="text-sm text-red-600">{partsError}</CardContent>
            </Card>
          ) : (
            <>
              <StatsCards parts={parts} />
              <PartsTable projectId={project.id} parts={parts} steelTypes={steelTypes} onPartsChange={setParts} />
              <AIAnalysisPanel
                projectId={project.id}
                hasPdf={Boolean(project.pdfFileUrl || machineContext?.drawingFileName)}
                parts={parts}
                onReloadParts={loadParts}
              />

              <Card className="bg-white">
                <CardHeader>
                  <CardTitle>Стратегия раскладки</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StrategySelector value={strategy} onChange={setStrategy} disabled={status === 'calculating'} />
                  <div className="flex flex-wrap items-center gap-2">
                    <LoadingButton
                      loading={isCalculating || status === 'calculating'}
                      loadingText="Расчёт раскладки..."
                      disabled={sheetMetalCount === 0 || !(status === 'parsed' || isCompletedNestingStatus(status))}
                      onClick={handleStartCalculation}
                    >
                      Рассчитать раскладку
                    </LoadingButton>
                    {isCompletedNestingStatus(status) && (
                      <Button type="button" variant="outline" onClick={handleViewResult}>
                        <Eye className="h-4 w-4" />
                        Проверить раскладку
                      </Button>
                    )}
                  </div>
                  {status === 'calculating' && (
                    <p className="flex items-center gap-2 text-sm text-[#6B7280]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Расчёт раскладки...
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

function MachineNestingContextCard({
  context,
  status,
  isImporting,
  onImport,
}: {
  context: MachineItemNestingContext
  status: NestingStatus | string
  isImporting: boolean
  onImport: () => void
}) {
  const isImported = context.status === 'imported'
  const canImport = isCompletedNestingStatus(status) && !isImported

  return (
    <Card className="bg-white">
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex items-start gap-2">
            <Package className="mt-0.5 h-4 w-4 text-[#1B3A6B]" />
            <div>
              <p className="text-xs text-[#6B7280]">Машина</p>
              <Link href={`/sales-plan/${context.machine_id}`} className="text-sm font-medium text-[#1B3A6B] hover:underline">
                {context.machineName}
              </Link>
            </div>
          </div>
          <div>
            <p className="text-xs text-[#6B7280]">Товар</p>
            <p className="text-sm font-medium text-[#374151]">{context.productName || context.machineItemName}</p>
            <p className="text-xs text-[#6B7280]">{context.drawingNumber} · x{context.quantity_multiplier}</p>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 text-[#6B7280]" />
            <div className="min-w-0">
              <p className="truncate text-xs text-[#6B7280]">{context.stepFileName}</p>
              <p className="truncate text-xs text-[#6B7280]">{context.drawingFileName}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isImported && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Импортировано
            </span>
          )}
          <LoadingButton
            loading={isImporting}
            loadingText="Импорт..."
            disabled={!canImport}
            onClick={onImport}
          >
            Импортировать в заявку
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  )
}

function Header({ project, status }: { project: NestingProject; status: NestingStatus | string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/nesting">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Проекты
          </Button>
        </Link>
        <div>
          <p className="text-sm text-[#6B7280]">Заказ</p>
          <h2 className="text-lg font-semibold text-[#1B3A6B]">{project.orderNumber}</h2>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        <span className="text-sm text-[#6B7280]">Изделий: {project.quantity}</span>
      </div>
    </div>
  )
}
