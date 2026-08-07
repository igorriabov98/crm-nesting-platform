'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Archive, CheckCircle2, Clock3, Cloud, FlaskConical, HardDrive, LoaderCircle, Power, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  buildArchivePreview,
  confirmArchivePreview,
  retryFailedArchiveFiles,
  runFileArchiveSelfTest,
  updateArchivePolicy,
  updateFileArchiveEnabled,
} from '@/lib/actions/file-archive'
import type { ArchiveRun, FileArchiveDashboard } from '@/lib/file-archive/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

function formatBytes(value: number) {
  if (value < 1024) return `${value} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

const runStatus: Record<ArchiveRun['status'], string> = {
  preview: 'Ждёт подтверждения', queued: 'В очереди', running: 'Выполняется', completed: 'Завершён', failed: 'Ошибка',
}

export function FileArchiveSettingsPage({ initial, canManage }: { initial: FileArchiveDashboard; canManage: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [policyPending, setPolicyPending] = useState<string | null>(null)
  const [confirmRun, setConfirmRun] = useState<ArchiveRun | null>(null)
  const [disableDialogOpen, setDisableDialogOpen] = useState(false)
  const [globalPending, setGlobalPending] = useState(false)
  const [testPending, setTestPending] = useState(false)
  const [testSteps, setTestSteps] = useState<string[]>([])

  useEffect(() => {
    if (searchParams.get('connected') === '1') toast.success('Google Drive подключён и выбран активным')
    const error = searchParams.get('error')
    if (error) toast.error(error)
  }, [searchParams])

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function togglePolicy(key: string, enabled: boolean) {
    setPolicyPending(key)
    const result = await updateArchivePolicy({ key, enabled })
    setPolicyPending(null)
    if (!result.success) return toast.error(result.error)
    toast.success(enabled ? 'Политика включена только для новых загрузок' : 'Политика выключена')
    refresh()
  }

  async function setArchiveEnabled(enabled: boolean) {
    setGlobalPending(true)
    const result = await updateFileArchiveEnabled({ enabled })
    setGlobalPending(false)
    if (!result.success) return toast.error(result.error)
    setDisableDialogOpen(false)
    toast.success(enabled ? 'Автоматическое архивирование включено' : 'Автоматическое архивирование выключено')
    refresh()
  }

  async function runSelfTest() {
    setTestPending(true)
    setTestSteps([])
    const result = await runFileArchiveSelfTest()
    setTestPending(false)
    setTestSteps(result.steps)
    if (!result.success) {
      toast.error(result.error)
      refresh()
      return
    }
    toast.success(`Тест архива пройден за ${(result.durationMs / 1000).toFixed(1)} с`)
    refresh()
  }

  async function preview() {
    const result = await buildArchivePreview()
    if (!result.success) return toast.error(result.error)
    toast.success('Неизменяемый предпросмотр сформирован')
    refresh()
  }

  async function confirm() {
    if (!confirmRun?.previewHash) return
    const result = await confirmArchivePreview({ runId: confirmRun.id, previewHash: confirmRun.previewHash })
    if (!result.success) return toast.error(result.error)
    setConfirmRun(null)
    toast.success(`В очередь добавлено файлов: ${result.queued}`)
    refresh()
  }

  async function retry() {
    const result = await retryFailedArchiveFiles()
    if (!result.success) return toast.error(result.error)
    toast.success('Ошибочные задания возвращены в очередь')
    refresh()
  }

  const active = initial.connections.find((connection) => connection.status === 'active')

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]"><Archive className="size-5" />Архив файлов</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <p>После 60 дней CRM копирует выбранные типы в My Drive, проверяет копию и ещё 7 дней хранит оригинал в Supabase.</p>
          {canManage ? (
            <Button render={<a href="/api/file-archive/oauth/start" />}>
              <Cloud className="size-4" />{active ? 'Сменить Google Drive' : 'Подключить Google Drive'}
            </Button>
          ) : <Badge variant="outline">Только просмотр</Badge>}
        </CardContent>
      </Card>

      <Card className={initial.globalEnabled ? 'border-emerald-200' : 'border-amber-200'}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`rounded-lg p-2 ${initial.globalEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              <Power className="size-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="file-archive-global-switch" className="font-medium text-foreground">Автоматическое архивирование</label>
                <Badge variant={initial.globalEnabled ? 'default' : 'outline'}>{initial.globalEnabled ? 'Включено' : 'Выключено'}</Badge>
              </div>
              <p id="file-archive-global-description" className="mt-1 text-sm text-muted-foreground">
                {initial.globalEnabled
                  ? 'Worker переносит подходящие файлы и удаляет проверенные Supabase-копии после 7 дней.'
                  : 'Новые переносы и удаления остановлены. Уже архивированные файлы по-прежнему открываются в CRM.'}
              </p>
            </div>
          </div>
          <Switch
            id="file-archive-global-switch"
            checked={initial.globalEnabled}
            disabled={!canManage || pending || globalPending || (!initial.globalEnabled && !active)}
            aria-describedby="file-archive-global-description"
            aria-label={initial.globalEnabled ? 'Выключить автоматическое архивирование' : 'Включить автоматическое архивирование'}
            onCheckedChange={(checked) => checked ? void setArchiveEnabled(true) : setDisableDialogOpen(true)}
          />
        </CardContent>
      </Card>

      {!active && (
        <Alert><ShieldCheck /><AlertTitle>Архивирование приостановлено</AlertTitle><AlertDescription>Подключите Google Drive. До этого ни один оригинал Supabase не удаляется.</AlertDescription></Alert>
      )}

      <section aria-labelledby="archive-metrics-title">
        <h2 id="archive-metrics-title" className="sr-only">Состояние архива</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={HardDrive} label="Освобождено в Supabase" value={formatBytes(initial.metrics.freedBytes)} />
          <MetricCard icon={Archive} label="Файлов на Drive" value={String(initial.metrics.archivedFiles)} />
          <MetricCard icon={Clock3} label="Ждут удаления 7 дней" value={`${initial.metrics.pendingDeleteFiles} · ${formatBytes(initial.metrics.pendingDeleteBytes)}`} />
          <MetricCard icon={AlertTriangle} label="Ошибки / очередь" value={`${initial.metrics.failedFiles} / ${initial.metrics.queuedFiles}`} danger={initial.metrics.failedFiles > 0} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
        <Card>
          <CardHeader><CardTitle className="text-lg">Типы файлов</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p className="mb-4 text-sm text-muted-foreground">Все типы выключены при первой поставке. Включение действует только для файлов, загруженных после этого момента.</p>
            {initial.policies.map((policy) => (
              <div key={policy.key} className="flex items-start justify-between gap-4 border-b py-3 last:border-0">
                <div>
                  <label htmlFor={`policy-${policy.key}`} className="cursor-pointer text-sm font-medium">{policy.label}</label>
                  <p className="mt-1 text-xs text-muted-foreground">{policy.category} · {policy.retentionDays} дней + {policy.localGraceDays} дней ожидания</p>
                </div>
                <Switch
                  id={`policy-${policy.key}`}
                  checked={policy.enabled}
                  disabled={!canManage || pending || policyPending === policy.key}
                  aria-label={`${policy.enabled ? 'Выключить' : 'Включить'}: ${policy.label}`}
                  onCheckedChange={(checked) => void togglePolicy(policy.key, checked)}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-lg">Подключённые диски</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {initial.connections.length === 0 ? <p className="text-sm text-muted-foreground">Нет подключений.</p> : initial.connections.map((connection) => (
                <div key={connection.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{connection.email}</span>
                    <Badge variant={connection.status === 'active' ? 'default' : connection.status === 'error' ? 'destructive' : 'outline'}>
                      {connection.status === 'active' ? 'Активный' : connection.status === 'read_only' ? 'Только чтение' : 'Ошибка'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{connection.archivedFiles} файлов · {formatBytes(connection.archivedBytes)}</p>
                  {connection.lastError && <p className="mt-2 text-xs text-destructive">{connection.lastError}</p>}
                </div>
              ))}
              <p className="text-xs leading-5 text-muted-foreground">Старые диски остаются доступны для чтения. CRM не отзывает их токены, пока там есть архивные файлы.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Обслуживание</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <FlaskConical className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">Безопасный тест Supabase → Drive</p>
                    <p id="archive-self-test-description" className="mt-1 text-xs leading-5 text-muted-foreground">Создаёт отдельный временный файл, проверяет запись и чтение в обоих хранилищах, затем удаляет только тестовые объекты.</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={!canManage || !active || pending || testPending}
                  aria-describedby="archive-self-test-description"
                  onClick={() => void runSelfTest()}
                >
                  {testPending ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                  {testPending ? 'Тест выполняется…' : 'Запустить тест архива'}
                </Button>
                <div className="mt-3 text-xs" aria-live="polite">
                  {initial.lastTest.status ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={initial.lastTest.status === 'passed' ? 'default' : 'destructive'}>
                          {initial.lastTest.status === 'passed' ? 'Последний тест пройден' : 'Последний тест: ошибка'}
                        </Badge>
                        <span className="text-muted-foreground">{formatDate(initial.lastTest.at)}{initial.lastTest.durationMs !== null ? ` · ${(initial.lastTest.durationMs / 1000).toFixed(1)} с` : ''}</span>
                      </div>
                      {initial.lastTest.connectionEmail && <p className="mt-2 text-muted-foreground">Drive: {initial.lastTest.connectionEmail}</p>}
                      {initial.lastTest.error && <p className="mt-2 text-destructive">{initial.lastTest.error}</p>}
                    </>
                  ) : <p className="text-muted-foreground">Тест ещё не запускался.</p>}
                  {testSteps.length > 0 && (
                    <ul className="mt-3 space-y-1 text-muted-foreground">
                      {testSteps.map((step) => <li key={step} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{step}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              <Button variant="outline" className="w-full" disabled={!canManage || pending} onClick={() => void preview()}><RefreshCw className="size-4" />Построить preview истории</Button>
              <Button variant="outline" className="w-full" disabled={!canManage || pending || initial.metrics.failedFiles === 0} onClick={() => void retry()}><AlertTriangle className="size-4" />Повторить ошибки</Button>
              <p className="text-xs text-muted-foreground">Последнее успешное копирование: {formatDate(initial.metrics.lastSuccessfulCopyAt)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Исторические предпросмотры и запуски</CardTitle></CardHeader>
        <CardContent>
          {initial.runs.length === 0 ? <p className="text-sm text-muted-foreground">Запусков ещё нет.</p> : (
            <div className="space-y-3">
              {initial.runs.map((run) => (
                <div key={run.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{run.kind === 'backfill' ? 'Исторический backfill' : 'Автоматический запуск'}</span><Badge variant="outline">{runStatus[run.status]}</Badge></div>
                    <p className="mt-1 text-xs text-muted-foreground">{run.itemCount} файлов · {formatBytes(run.totalBytes)} · машин: {run.machineCount} · без привязки: {run.missingRelationCount} · создан {formatDate(run.createdAt)}</p>
                    {run.categorySummary.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {run.categorySummary.map((item) => <Badge key={item.category} variant="secondary">{item.category}: {item.count} · {formatBytes(item.bytes)}</Badge>)}
                      </div>
                    )}
                  </div>
                  {canManage && run.status === 'preview' && run.previewHash && <Button disabled={pending} onClick={() => setConfirmRun(run)}>Проверить и подтвердить</Button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="sr-only" aria-live="polite">{pending ? 'Обновление данных' : 'Данные обновлены'}</p>
      <AlertDialog open={Boolean(confirmRun)} onOpenChange={(open) => !open && setConfirmRun(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить исторический перенос?</AlertDialogTitle>
            <AlertDialogDescription>
              В очередь попадут {confirmRun?.itemCount || 0} файлов общим объёмом {formatBytes(confirmRun?.totalBytes || 0)}. Supabase-копии будут удаляться только после проверки Drive и семидневного ожидания.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => void confirm()}><CheckCircle2 className="size-4" />Подтвердить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выключить автоматическое архивирование?</AlertDialogTitle>
            <AlertDialogDescription>
              Новые копирования и удаления из Supabase остановятся. Уже архивированные файлы останутся доступны, а незавершённые задания продолжатся после повторного включения.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={globalPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={globalPending} onClick={() => void setArchiveEnabled(false)}>
              {globalPending ? <LoaderCircle className="size-4 animate-spin" /> : <Power className="size-4" />}
              Выключить архивирование
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, danger = false }: { icon: React.ElementType; label: string; value: string; danger?: boolean }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-lg p-2 ${danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}><Icon className="size-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div></CardContent></Card>
}
