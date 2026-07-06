'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bot, CheckCircle2, Info, Loader2, Undo2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ROUTES } from '@/lib/constants/routes'
import type { AIAnalysisResponse, AIMatchResult, AIStatus, NestingPart } from '@/lib/nesting/api'

type ApplyMatchPayload = {
  partId: string
  material?: string
  steelTypeId?: string | null
  steelTypeName?: string | null
  steelTypeRaw?: string | null
  quantity?: number
  thickness?: number
  isSheetMetal?: boolean
  hasBends?: boolean
  unfoldingWidth?: number
  unfoldingHeight?: number
}

type DimensionMismatchState = {
  note: string
  payload: ApplyMatchPayload[]
}

export function AIAnalysisPanel({
  projectId,
  hasPdf,
  parts,
  onReloadParts,
}: {
  projectId: string
  hasPdf: boolean
  parts: NestingPart[]
  onReloadParts: () => Promise<void>
}) {
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AIAnalysisResponse['data'] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isLoadingSpecification, setIsLoadingSpecification] = useState(false)
  const [specificationError, setSpecificationError] = useState<string | null>(null)
  const [dimensionMismatch, setDimensionMismatch] = useState<DimensionMismatchState | null>(null)

  const partsById = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts])
  const proposedMatches = useMemo(() => {
    return (analysis?.matches || []).filter((match) => isProposed(match))
  }, [analysis])
  const appliedMatches = useMemo(() => {
    return (analysis?.matches || []).filter((match) => isApplied(match))
  }, [analysis])
  const selectedProposedMatches = useMemo(
    () => proposedMatches.filter((match) => selected[match.partId]),
    [proposedMatches, selected]
  )
  const selectedAppliedMatches = useMemo(
    () => appliedMatches.filter((match) => selected[match.partId]),
    [appliedMatches, selected]
  )
  const autoAppliedFieldCount = useMemo(() => {
    return (analysis?.matches || [])
      .filter((match) => match.applyStatus === 'applied_auto' || (match.autoApplied && !match.applyStatus))
      .reduce((total, match) => total + countSuggestedFields(match), 0)
  }, [analysis])

  const loadSpecification = useCallback(async () => {
    setIsLoadingSpecification(true)
    setSpecificationError(null)
    try {
      const res = await fetch(`/api/nesting/ai/specification/${projectId}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось загрузить PDF-спецификацию')
      }

      const result = (data as { data?: AIAnalysisResponse['data'] | null }).data ?? null
      setAnalysis(result)
      setSelected(Object.fromEntries(
        (result?.matches || [])
          .filter((match) => isProposed(match))
          .map((match) => [match.partId, isDefaultSelected(match)])
      ))
    } catch (error) {
      setSpecificationError(error instanceof Error ? error.message : 'Не удалось загрузить PDF-спецификацию')
    } finally {
      setIsLoadingSpecification(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!hasPdf) return

    let cancelled = false
    fetch('/api/nesting/ai/status')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Не удалось проверить статус AI')
        if (!cancelled) setStatus(data as AIStatus)
      })
      .catch((error) => {
        if (!cancelled) setStatusError(error instanceof Error ? error.message : 'Не удалось проверить статус AI')
      })

    return () => {
      cancelled = true
    }
  }, [hasPdf])

  useEffect(() => {
    if (!hasPdf) return
    void loadSpecification()
  }, [hasPdf, loadSpecification])

  async function analyze() {
    setIsAnalyzing(true)
    try {
      const res = await fetch(`/api/nesting/ai/analyze/${projectId}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось выполнить AI-анализ PDF')
      }

      const result = (data as AIAnalysisResponse).data
      setAnalysis(result)
      setSelected(Object.fromEntries(
        result.matches
          .filter((match) => isProposed(match))
          .map((match) => [match.partId, isDefaultSelected(match)])
      ))
      await onReloadParts()
      await loadSpecification()
      toast.success('Спецификация извлечена из PDF')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось выполнить AI-анализ PDF')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function applySelected() {
    const payload = selectedProposedMatches.map(matchToApplyPayload)

    if (payload.length === 0) {
      toast.error('Выберите хотя бы одно предложение AI')
      return
    }

    await submitApply(payload, false)
  }

  async function forceMatch(match: AIMatchResult) {
    const part = partsById.get(match.partId)
    const confirmed = window.confirm(buildForceConfirmText(match, part))

    if (!confirmed) return

    await submitApply([matchToApplyPayload(match)], true)
  }

  async function applyForced() {
    if (!dimensionMismatch) return

    const confirmed = window.confirm(
      `${dimensionMismatch.note}\n\nПрименить данные из PDF принудительно?`
    )

    if (!confirmed) return

    await submitApply(dimensionMismatch.payload, true)
  }

  async function revertMatches(partIds: string[]) {
    if (partIds.length === 0) {
      toast.error('Выберите хотя бы одну применённую строку')
      return
    }

    setIsApplying(true)
    try {
      const res = await fetch(`/api/nesting/ai/revert/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partIds }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отменить AI-изменения')
      }

      await onReloadParts()
      await loadSpecification()
      setSelected({})
      setDimensionMismatch(null)
      toast.success(`Отменено деталей: ${data.reverted || 0}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отменить AI-изменения')
    } finally {
      setIsApplying(false)
    }
  }

  async function revertSelected() {
    await revertMatches(selectedAppliedMatches.map((match) => match.partId))
  }

  async function revertAllApplied() {
    await revertMatches(appliedMatches.map((match) => match.partId))
  }

  async function submitApply(payload: ApplyMatchPayload[], force: boolean) {
    setIsApplying(true)
    try {
      const res = await fetch(`/api/nesting/ai/apply/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: payload, force }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const details = data.details as { mismatchNote?: string; thicknessMismatchNote?: string } | undefined
        const mismatchNote = details?.mismatchNote || details?.thicknessMismatchNote
        if (res.status === 409 && mismatchNote) {
          setDimensionMismatch({ note: mismatchNote, payload })
          throw new Error(details?.thicknessMismatchNote ? 'Толщина BOM расходится с геометрией STEP' : 'Размеры PDF расходятся с геометрией STEP')
        }

        throw new Error(data.error || 'Не удалось применить предложения AI')
      }

      await onReloadParts()
      await loadSpecification()
      setSelected({})
      setDimensionMismatch(null)
      toast.success(`Обновлено деталей: ${data.updated || 0}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось применить предложения AI')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI-анализ чертежа
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasPdf ? (
          <p className="text-sm text-[#6B7280]">PDF не загружен для этого проекта.</p>
        ) : statusError ? (
          <p className="text-sm text-red-600">{statusError}</p>
        ) : status && !status.hasApiKey ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            AI не настроен. Директор может добавить OpenRouter API ключ в разделе{' '}
            <Link href={ROUTES.NESTING_SETTINGS} className="font-medium underline">
              Настройки AI
            </Link>.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={analyze} disabled={isAnalyzing || !status}>
                {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                {isAnalyzing ? 'AI анализирует PDF...' : 'Извлечь спецификацию из PDF'}
              </Button>
              {status?.budgetWarning && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  Бюджет превышен, анализ не блокируется
                </Badge>
              )}
              {status && (
                <Badge variant="outline" className={status.autoApplyResults ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}>
                  Автоприменение: {status.autoApplyResults ? 'ON' : 'OFF'}
                </Badge>
              )}
            </div>

            {isLoadingSpecification && !analysis && (
              <p className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка сохранённой PDF-спецификации...
              </p>
            )}

            {specificationError && (
              <p className="flex items-center gap-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                {specificationError}
              </p>
            )}

            {analysis && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm text-[#6B7280]">
                  <span className="font-medium text-[#1B3A6B]">Спецификация PDF</span>
                  <span>BOM строк: {analysis.bom.length}</span>
                  <span>Токены: {analysis.tokensUsed}</span>
                  <span>Модель: {analysis.model}</span>
                  {analysis.updatedAt && <span>Обновлено: {new Date(analysis.updatedAt).toLocaleString('ru-RU')}</span>}
                </div>

                {autoAppliedFieldCount > 0 && (
                  <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                    <span>Применено автоматически {autoAppliedFieldCount} полей</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(Object.fromEntries(appliedMatches.map((match) => [match.partId, true])))}
                    >
                      Просмотреть/Отменить
                    </Button>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-[#E8ECF0]">
                  <TooltipProvider>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#F8F9FA]">
                          <TableHead>Деталь</TableHead>
                          <TableHead>BOM совпал</TableHead>
                          <TableHead>Метод</TableHead>
                          <TableHead>Детали</TableHead>
                          <TableHead>Материал</TableHead>
                          <TableHead>Тип стали</TableHead>
                          <TableHead>Толщ.</TableHead>
                          <TableHead>Развёртка</TableHead>
                          <TableHead>Кол-во</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Действие</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.matches.map((match) => {
                        const part = partsById.get(match.partId)
                        const confidence = Math.round(match.matchConfidence * 100)
                        const applied = isApplied(match)
                        const proposed = isProposed(match)
                        const needsForce = canForce(match, part)
                        const canSelect = proposed || applied

                        return (
                          <TableRow key={match.partId}>
                            <TableCell className="max-w-[220px] truncate font-medium text-[#1B3A6B]">
                              {match.partName}
                            </TableCell>
                            <TableCell>
                              {match.matchType === 'none' ? (
                                <span className="inline-flex items-center gap-1 text-red-600">
                                  <XCircle className="h-4 w-4" />
                                  нет
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <CheckCircle2 className="h-4 w-4" />
                                  {confidence}% · {match.bomPosition || match.bomDesignation || match.bomName}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {match.matchType === 'none' ? (
                                <span className="text-[#6B7280]">—</span>
                              ) : (
                                <Badge variant={match.matchType === 'geometry' ? 'default' : 'outline'}>
                                  {matchTypeLabel(match.matchType)}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[240px]">
                              {match.matchDetails ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-[#475569]">
                                        <Info className="h-3.5 w-3.5 shrink-0" />
                                        {match.matchDetails}
                                      </span>
                                    }
                                  />
                                  <TooltipContent className="max-w-sm whitespace-normal">{match.matchDetails}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-[#6B7280]">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedMaterial ? (
                                applied ? (
                                  `Применено: ${match.suggestedMaterial}`
                                ) : (
                                  <ChangeText from={part?.material || '—'} to={match.suggestedMaterial} />
                                )
                              ) : (
                                <OkText value={part?.material || '—'} />
                              )}
                            </TableCell>
                            <TableCell>
                              {match.steelTypeWarning ? (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <AlertTriangle className="h-4 w-4" />
                                  {match.steelTypeWarning}
                                </span>
                              ) : match.suggestedSteelTypeName || match.suggestedSteelTypeRaw ? (
                                applied ? (
                                  `Применено: ${match.suggestedSteelTypeName || match.suggestedSteelTypeRaw}`
                                ) : (
                                  <ChangeText
                                    from={part?.steelTypeName || part?.steelTypeRaw || '—'}
                                    to={match.suggestedSteelTypeName || match.suggestedSteelTypeRaw || '—'}
                                  />
                                )
                              ) : (
                                <OkText value={part?.steelTypeName || part?.steelTypeRaw || match.suggestedMaterialGrade || '—'} />
                              )}
                            </TableCell>
                            <TableCell>
                              {match.thicknessMismatch ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex items-center gap-1 text-amber-700">
                                        <AlertTriangle className="h-4 w-4" />
                                        {match.suggestedThickness ? (
                                          <ChangeText from={formatThickness(part?.thickness)} to={formatThickness(match.suggestedThickness)} />
                                        ) : (
                                          formatThickness(part?.thickness)
                                        )}
                                      </span>
                                    }
                                  />
                                  <TooltipContent className="max-w-sm whitespace-normal">
                                    {match.thicknessMismatchNote || 'Толщина BOM расходится с геометрией STEP'}
                                  </TooltipContent>
                                </Tooltip>
                              ) : match.suggestedThickness ? (
                                applied ? (
                                  `Применено: ${formatThickness(match.suggestedThickness)}`
                                ) : (
                                  <ChangeText from={formatThickness(part?.thickness)} to={formatThickness(match.suggestedThickness)} />
                                )
                              ) : (
                                <OkText value={formatThickness(part?.thickness)} />
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedUnfoldingWidth && match.suggestedUnfoldingHeight ? (
                                <span className="inline-flex items-center gap-2">
                                  {part?.dimensionMismatch && !applied ? (
                                    <>
                                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                                      <ChangeText
                                        from={formatSize(part.width, part.height)}
                                        to={formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}
                                      />
                                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">заблокировано</Badge>
                                    </>
                                  ) : (
                                    <>
                                      {applied ? 'Применено: ' : null}
                                      {formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}
                                      {!applied && <Badge variant="outline">PDF</Badge>}
                                    </>
                                  )}
                                </span>
                              ) : (
                                <span className="text-[#6B7280]">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedQuantity
                                ? applied ? `Применено: ${match.suggestedQuantity}` : <ChangeText from={String(part?.quantity || '—')} to={String(match.suggestedQuantity)} />
                                : <OkText value={String(part?.quantity || '—')} />}
                            </TableCell>
                            <TableCell>
                              <ApplyStatusBadge match={match} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                {canSelect ? (
                                  <Checkbox
                                    checked={selected[match.partId] === true}
                                    onCheckedChange={(checked) => setSelected((current) => ({ ...current, [match.partId]: checked === true }))}
                                  />
                                ) : null}
                                {needsForce ? (
                                  <Button type="button" variant="outline" size="sm" onClick={() => forceMatch(match)} disabled={isApplying}>
                                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                                    Применить принудительно
                                  </Button>
                                ) : null}
                                {applied ? (
                                  <Button type="button" variant="outline" size="sm" onClick={() => revertMatches([match.partId])} disabled={isApplying}>
                                    <Undo2 className="mr-1 h-3.5 w-3.5" />
                                    Отменить
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                        })}
                      </TableBody>
                    </Table>
                  </TooltipProvider>
                </div>

                {analysis.unmatchedBom.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">Строки PDF без детали в STEP: {analysis.unmatchedBom.length}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysis.unmatchedBom.slice(0, 8).map((entry, index) => (
                        <Badge key={`${entry.position}-${entry.name}-${index}`} variant="outline" className="bg-white">
                          {[entry.position, entry.designation, entry.name, entry.steelTypeName || entry.steelTypeRaw].filter(Boolean).join(' · ')}
                        </Badge>
                      ))}
                      {analysis.unmatchedBom.length > 8 && <span>ещё {analysis.unmatchedBom.length - 8}</span>}
                    </div>
                  </div>
                )}

                {dimensionMismatch && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <p>{dimensionMismatch.note}</p>
                      <Button type="button" variant="outline" onClick={applyForced} disabled={isApplying}>
                        {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                        Применить принудительно
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applySelected} disabled={isApplying || proposedMatches.length === 0}>
                    {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Применить выбранные
                  </Button>
                  <Button type="button" variant="outline" onClick={revertSelected} disabled={isApplying || selectedAppliedMatches.length === 0}>
                    <Undo2 className="mr-2 h-4 w-4" />
                    Отменить выбранные
                  </Button>
                  <Button type="button" variant="outline" onClick={revertAllApplied} disabled={isApplying || appliedMatches.length === 0}>
                    Отменить все применённые
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelected({})} disabled={isApplying || (proposedMatches.length === 0 && selectedAppliedMatches.length === 0)}>
                    Отклонить все
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ChangeText({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-amber-700">
      <span className="text-[#6B7280]">{from}</span>
      <span>→</span>
      <span className="font-medium">{to}</span>
    </span>
  )
}

function OkText({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <CheckCircle2 className="h-4 w-4" />
      {value}
    </span>
  )
}

function ApplyStatusBadge({ match }: { match: AIMatchResult }) {
  if (match.applyStatus === 'applied_forced') {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Применено принудительно</Badge>
  }

  if (match.applyStatus === 'applied_manual') {
    return <Badge className="bg-emerald-100 text-emerald-700">Применено вручную</Badge>
  }

  if (match.applyStatus === 'applied_auto' || (match.autoApplied && !match.applyStatus)) {
    return <Badge className="bg-emerald-100 text-emerald-700">Применено автоматически</Badge>
  }

  if (match.applyStatus === 'needs_force' || match.thicknessMismatch) {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Требует подтверждения</Badge>
  }

  if (match.applyStatus === 'reverted') {
    return <Badge variant="outline">Отменено</Badge>
  }

  if (match.applyStatus === 'rejected') {
    return <Badge variant="outline">Отклонено</Badge>
  }

  if (match.steelTypeWarning) {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Нужен ручной тип стали</Badge>
  }

  if (hasSuggestion(match)) {
    if (match.matchConfidence < 0.8) {
      return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Низкая уверенность</Badge>
    }

    return <Badge variant="outline">Предложено</Badge>
  }

  return <span className="text-[#6B7280]">Без изменений</span>
}

function matchToApplyPayload(match: AIMatchResult): ApplyMatchPayload {
  return {
    partId: match.partId,
    material: match.suggestedMaterial || undefined,
    steelTypeId: match.suggestedSteelTypeId || undefined,
    steelTypeName: match.suggestedSteelTypeName || undefined,
    steelTypeRaw: match.suggestedSteelTypeRaw || undefined,
    quantity: match.suggestedQuantity || undefined,
    thickness: match.suggestedThickness || undefined,
    isSheetMetal: match.suggestedIsSheetMetal ?? undefined,
    hasBends: match.suggestedHasBends ?? undefined,
    unfoldingWidth: match.suggestedUnfoldingWidth || undefined,
    unfoldingHeight: match.suggestedUnfoldingHeight || undefined,
  }
}

function isApplied(match: AIMatchResult) {
  return match.autoApplied || match.applyStatus === 'applied_auto' || match.applyStatus === 'applied_manual' || match.applyStatus === 'applied_forced'
}

function isProposed(match: AIMatchResult) {
  return hasSuggestion(match) && !isApplied(match) && match.applyStatus !== 'needs_force' && match.applyStatus !== 'rejected'
}

function canForce(match: AIMatchResult, part: NestingPart | undefined) {
  if (!part || !hasSuggestion(match) || isApplied(match)) return false

  const hasBlockedThickness = match.thicknessMismatch && typeof match.suggestedThickness === 'number'
  const hasBlockedDimensions = part.dimensionMismatch && typeof match.suggestedUnfoldingWidth === 'number' && typeof match.suggestedUnfoldingHeight === 'number'
  return match.applyStatus === 'needs_force' || hasBlockedThickness || hasBlockedDimensions
}

function isDefaultSelected(match: AIMatchResult) {
  return match.matchConfidence >= 0.8
}

function countSuggestedFields(match: AIMatchResult) {
  let count = 0
  if (match.suggestedMaterial) count += 1
  if (match.suggestedSteelTypeId || match.suggestedSteelTypeRaw) count += 1
  if (typeof match.suggestedThickness === 'number') count += 1
  if (typeof match.suggestedQuantity === 'number') count += 1
  if (typeof match.suggestedIsSheetMetal === 'boolean') count += 1
  if (typeof match.suggestedHasBends === 'boolean') count += 1
  if (typeof match.suggestedUnfoldingWidth === 'number' && typeof match.suggestedUnfoldingHeight === 'number') count += 1
  return count
}

function buildForceConfirmText(match: AIMatchResult, part: NestingPart | undefined) {
  const lines = ['Применить принудительно?', '']

  if (part && typeof match.suggestedUnfoldingWidth === 'number' && typeof match.suggestedUnfoldingHeight === 'number') {
    const areaDiff = percentDelta(part.width * part.height, match.suggestedUnfoldingWidth * match.suggestedUnfoldingHeight)
    const aspectDiff = percentDelta(normalizedAspect(part.width, part.height), normalizedAspect(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight))
    lines.push(`PDF: ${formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}`)
    lines.push(`STEP: ${formatSize(part.width, part.height)}`)
    lines.push(`Расхождение площади: ${formatPercent(areaDiff)}, сторон: ${formatPercent(aspectDiff)}`)
    lines.push('')
    lines.push('Размеры детали будут заменены значениями из чертежа.')
  }

  if (part && typeof match.suggestedThickness === 'number') {
    const thicknessDiff = percentDelta(part.thickness, match.suggestedThickness)
    lines.push(`Толщина PDF: ${formatThickness(match.suggestedThickness)}`)
    lines.push(`Толщина STEP: ${formatThickness(part.thickness)}`)
    lines.push(`Расхождение толщины: ${formatPercent(thicknessDiff)}`)
  }

  if (match.thicknessMismatchNote) {
    lines.push('')
    lines.push(match.thicknessMismatchNote)
  } else if (part?.mismatchNote) {
    lines.push('')
    lines.push(part.mismatchNote)
  }

  return lines.join('\n')
}

function formatThickness(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)} мм` : '—'
}

function formatSize(width: number, height: number) {
  return `${formatNumber(width)}×${formatNumber(height)} мм`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

function formatPercent(value: number) {
  return `${formatNumber(value)}%`
}

function percentDelta(current: number, next: number) {
  if (!Number.isFinite(current) || !Number.isFinite(next) || current <= 0 || next <= 0) return 0
  return Math.abs(next - current) / current * 100
}

function normalizedAspect(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0
  return Math.max(width, height) / Math.min(width, height)
}

function matchTypeLabel(type: AIMatchResult['matchType']) {
  switch (type) {
    case 'geometry':
      return 'Геометрия'
    case 'designation':
      return 'Обозначение'
    case 'exact':
      return 'Имя'
    case 'contains':
      return 'Имя'
    case 'fuzzy':
      return 'Похоже'
    default:
      return '—'
  }
}

function hasSuggestion(match: AIMatchResult) {
  return Boolean(
    match.suggestedMaterial ||
      match.suggestedQuantity ||
      match.suggestedSteelTypeId ||
      match.suggestedSteelTypeRaw ||
      match.suggestedThickness ||
      match.suggestedUnfoldingWidth ||
      match.suggestedUnfoldingHeight ||
      typeof match.suggestedIsSheetMetal === 'boolean' ||
      typeof match.suggestedHasBends === 'boolean'
  )
}
