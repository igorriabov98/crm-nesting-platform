'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bot, CheckCircle2, Info, Loader2, Undo2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/components/providers/PermissionProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ROUTES } from '@/lib/constants/routes'
import { isAIMatchApplyEligible } from '@/lib/nesting/ai-match-policy'
import { getDimensionChoice, POSSIBLE_FOLDED_VIEW_HINT } from '@/lib/nesting/dimension-choice'
import type { AIAnalysisResponse, AIMatchResult, AIStatus, ApplyBOMBlockedRow, NestingPart, PartType } from '@/lib/nesting/api'

type ApplyMatchPayload = {
  partId: string
  material?: string
  steelTypeId?: string | null
  steelTypeName?: string | null
  steelTypeRaw?: string | null
  quantity?: number
  thickness?: number
  isSheetMetal?: boolean
  partType?: PartType
  hasBends?: boolean
  unfoldingWidth?: number
  unfoldingHeight?: number
}

type DimensionMismatchState = {
  note: string
  payload: ApplyMatchPayload[]
}

type BatchApplyState = {
  applied: number
  blocked: ApplyBOMBlockedRow[]
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
  const { can } = usePermissions()
  const canManage = can('nesting', 'manage')
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AIAnalysisResponse['data'] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isLoadingSpecification, setIsLoadingSpecification] = useState(false)
  const [specificationError, setSpecificationError] = useState<string | null>(null)
  const [dimensionMismatch, setDimensionMismatch] = useState<DimensionMismatchState | null>(null)
  const [batchApply, setBatchApply] = useState<BatchApplyState | null>(null)

  const partsById = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts])
  const activeMatches = useMemo(() => {
    return (analysis?.matches || []).filter((match) => partsById.get(match.partId)?.isActive !== false)
  }, [analysis, partsById])
  const proposedMatches = useMemo(() => {
    return activeMatches.filter((match) => isProposed(match))
  }, [activeMatches])
  const applicableProposedMatches = useMemo(() => {
    return proposedMatches.filter((match) => isAIMatchApplyEligible(match))
  }, [proposedMatches])
  const appliedMatches = useMemo(() => {
    return activeMatches.filter((match) => isApplied(match))
  }, [activeMatches])
  const selectedProposedMatches = useMemo(
    () => applicableProposedMatches.filter((match) => selected[match.partId]),
    [applicableProposedMatches, selected]
  )
  const selectedAppliedMatches = useMemo(
    () => appliedMatches.filter((match) => selected[match.partId]),
    [appliedMatches, selected]
  )
  const autoAppliedFieldCount = useMemo(() => {
    return activeMatches
      .filter((match) => match.applyStatus === 'applied_auto' || (match.autoApplied && !match.applyStatus))
      .reduce((total, match) => total + countSuggestedFields(match), 0)
  }, [activeMatches])

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
      if (result.analysisStatus === 'completed') {
        toast.success('Спецификация извлечена из PDF')
      } else {
        toast.warning('AI не справился: использован текстовый парсер, результат требует проверки')
      }
    } catch (error) {
      await loadSpecification()
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
      setBatchApply(null)
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
      const blocked = readBlockedRows(data)
      const updated = typeof data.updated === 'number' ? data.updated : 0
      if (blocked.length > 0) {
        setBatchApply({ applied: updated, blocked })
        toast.warning(`Применено ${updated}, заблокировано ${blocked.length}`)
      } else {
        setBatchApply(null)
        toast.success(`Обновлено деталей: ${updated}`)
      }
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
              <Button type="button" onClick={analyze} disabled={!canManage || isAnalyzing || !status}>
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
                {analysis.analysisStatus !== 'completed' && (
                  <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                    <div>
                      <p className="font-semibold">AI-анализ не выполнен</p>
                      <p className="mt-1">{analysis.warning || 'Ответ AI нельзя использовать как достоверную спецификацию.'}</p>
                      {analysis.analysisStatus === 'deterministic_fallback' && (
                        <p className="mt-1 font-medium">Источник: deterministic fallback. Проверьте BOM до расчёта.</p>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 text-sm text-[#6B7280]">
                  <span className="font-medium text-[#1B3A6B]">Спецификация PDF</span>
                  <span>BOM строк: {analysis.bom.length}</span>
                  <span>Токены: {analysis.promptTokens} + {analysis.completionTokens}</span>
                  <span>finish_reason: {analysis.finishReason || '—'}</span>
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
                          <TableHead>Тип</TableHead>
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
                        {activeMatches.map((match) => {
                        const part = partsById.get(match.partId)
                        const confidence = Math.round(match.matchConfidence * 100)
                        const applied = isApplied(match)
                        const proposed = isProposed(match)
                        const dimensionChoice = getDimensionChoice(match, part)
                        const needsForce = canForce(match, part)
                        const canSelect = canManage && ((proposed && isAIMatchApplyEligible(match)) || applied)

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
                                <div className="flex flex-col items-start gap-1">
                                  <Badge variant={match.matchType === 'geometry' ? 'default' : 'outline'}>
                                    {matchTypeLabel(match.matchType)}
                                  </Badge>
                                  {match.scopeConfirmed && !match.identityConfirmed ? (
                                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                      Сборка подтверждена, деталь — нет
                                    </Badge>
                                  ) : null}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedPartType ? (
                                applied ? (
                                  `Применено: ${partTypeLabel(match.suggestedPartType)}`
                                ) : (
                                  <ChangeText from={partTypeLabel(part?.partType)} to={partTypeLabel(match.suggestedPartType)} />
                                )
                              ) : (
                                <OkText value={partTypeLabel(part?.partType)} />
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
                                <div className="flex min-w-[260px] flex-col gap-1">
                                  {dimensionChoice.isConflict && part && !applied ? (
                                    <div className="space-y-1 text-xs">
                                      <div className="flex flex-wrap items-center gap-2 text-amber-800">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span>
                                          STEP: <span className="font-medium">{formatSize(part.width, part.height)}</span>
                                          {' | '}
                                          PDF: <span className="font-medium">{formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}</span>
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                          Конфликт размеров · {formatPercent(dimensionChoice.mismatchPercent)}
                                        </Badge>
                                        {dimensionChoice.possibleFoldedView ? (
                                          <span className="max-w-[360px] text-amber-700">{POSSIBLE_FOLDED_VIEW_HINT}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="inline-flex items-center gap-2">
                                      {applied ? 'Применено: ' : null}
                                      {formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}
                                      {!applied && <Badge variant="outline">PDF</Badge>}
                                    </span>
                                  )}
                                </div>
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
                                  <Button type="button" variant="outline" size="sm" onClick={() => forceMatch(match)} disabled={!canManage || isApplying}>
                                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                                    {dimensionChoice.isConflict ? 'Применить размеры из PDF' : 'Применить принудительно'}
                                  </Button>
                                ) : null}
                                {proposed && !isAIMatchApplyEligible(match) ? (
                                  <span className="max-w-[220px] text-xs text-amber-700">
                                    Недоступно: нужна подтверждённая деталь и уверенность не ниже 80%
                                  </span>
                                ) : null}
                                {applied ? (
                                  <Button type="button" variant="outline" size="sm" onClick={() => revertMatches([match.partId])} disabled={!canManage || isApplying}>
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
                      <Button type="button" variant="outline" onClick={applyForced} disabled={!canManage || isApplying}>
                        {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                        Применить принудительно
                      </Button>
                    </div>
                  </div>
                )}

                {batchApply && batchApply.blocked.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-medium">Применено {batchApply.applied}, заблокировано {batchApply.blocked.length}</p>
                    <div className="mt-2 space-y-1">
                      {batchApply.blocked.map((row) => (
                        <div key={row.partId} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.partName}</span>
                          <span>{blockedReasonLabel(row)}</span>
                          <Badge variant="outline" className="border-amber-200 bg-white text-amber-800">
                            {blockedValuesLabel(row)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applySelected} disabled={!canManage || isApplying || applicableProposedMatches.length === 0}>
                    {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Применить выбранные
                  </Button>
                  <Button type="button" variant="outline" onClick={revertSelected} disabled={!canManage || isApplying || selectedAppliedMatches.length === 0}>
                    <Undo2 className="mr-2 h-4 w-4" />
                    Отменить выбранные
                  </Button>
                  <Button type="button" variant="outline" onClick={revertAllApplied} disabled={!canManage || isApplying || appliedMatches.length === 0}>
                    Отменить все применённые
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelected({})} disabled={!canManage || isApplying || (proposedMatches.length === 0 && selectedAppliedMatches.length === 0)}>
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

  if (match.applyStatus === 'needs_force' || match.thicknessMismatch || match.dimensionMismatch) {
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
    if (!match.identityConfirmed) {
      return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Личность не подтверждена</Badge>
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
    partType: match.suggestedPartType ?? undefined,
    hasBends: match.suggestedHasBends ?? undefined,
    unfoldingWidth: match.suggestedUnfoldingWidth || undefined,
    unfoldingHeight: match.suggestedUnfoldingHeight || undefined,
  }
}

function readBlockedRows(data: unknown): ApplyBOMBlockedRow[] {
  if (!data || typeof data !== 'object' || !('blocked' in data)) return []
  const blocked = (data as { blocked?: unknown }).blocked
  return Array.isArray(blocked) ? blocked.filter(isBlockedRow) : []
}

function isBlockedRow(value: unknown): value is ApplyBOMBlockedRow {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ApplyBOMBlockedRow).partId === 'string' &&
      typeof (value as ApplyBOMBlockedRow).partName === 'string' &&
      ((value as ApplyBOMBlockedRow).reason === 'dimension_mismatch' || (value as ApplyBOMBlockedRow).reason === 'thickness_mismatch')
  )
}

function blockedReasonLabel(row: ApplyBOMBlockedRow) {
  return row.reason === 'thickness_mismatch'
    ? 'толщина PDF расходится с STEP'
    : 'размеры PDF расходятся с STEP'
}

function blockedValuesLabel(row: ApplyBOMBlockedRow) {
  if (row.reason === 'thickness_mismatch') {
    return `PDF ${formatThickness(row.pdf.thickness)} · STEP ${formatThickness(row.step.thickness)}`
  }

  const pdfSize = typeof row.pdf.width === 'number' && typeof row.pdf.height === 'number'
    ? formatSize(row.pdf.width, row.pdf.height)
    : '—'
  const stepSize = typeof row.step.width === 'number' && typeof row.step.height === 'number'
    ? formatSize(row.step.width, row.step.height)
    : '—'
  return `PDF ${pdfSize} · STEP ${stepSize}`
}

function isApplied(match: AIMatchResult) {
  return match.autoApplied || match.applyStatus === 'applied_auto' || match.applyStatus === 'applied_manual' || match.applyStatus === 'applied_forced'
}

function isProposed(match: AIMatchResult) {
  return hasSuggestion(match) && !isApplied(match) && match.applyStatus !== 'needs_force' && match.applyStatus !== 'rejected'
}

function canForce(match: AIMatchResult, part: NestingPart | undefined) {
  if (!part || !hasSuggestion(match) || isApplied(match) || !isAIMatchApplyEligible(match)) return false

  const hasBlockedThickness = match.thicknessMismatch && typeof match.suggestedThickness === 'number'
  const hasBlockedDimensions = getDimensionChoice(match, part).isConflict
  return match.applyStatus === 'needs_force' || hasBlockedThickness || hasBlockedDimensions
}

function isDefaultSelected(match: AIMatchResult) {
  return isAIMatchApplyEligible(match)
}

function countSuggestedFields(match: AIMatchResult) {
  let count = 0
  if (match.suggestedMaterial) count += 1
  if (match.suggestedSteelTypeId || match.suggestedSteelTypeRaw) count += 1
  if (typeof match.suggestedThickness === 'number') count += 1
  if (typeof match.suggestedQuantity === 'number') count += 1
  if (typeof match.suggestedIsSheetMetal === 'boolean') count += 1
  if (match.suggestedPartType) count += 1
  if (typeof match.suggestedHasBends === 'boolean') count += 1
  if (typeof match.suggestedUnfoldingWidth === 'number' && typeof match.suggestedUnfoldingHeight === 'number') count += 1
  return count
}

function buildForceConfirmText(match: AIMatchResult, part: NestingPart | undefined) {
  const dimensionChoice = getDimensionChoice(match, part)
  const lines = [dimensionChoice.isConflict ? 'Применить размеры из PDF?' : 'Применить принудительно?', '']

  if (part && typeof match.suggestedUnfoldingWidth === 'number' && typeof match.suggestedUnfoldingHeight === 'number') {
    const areaDiff = percentDelta(part.width * part.height, match.suggestedUnfoldingWidth * match.suggestedUnfoldingHeight)
    const aspectDiff = percentDelta(normalizedAspect(part.width, part.height), normalizedAspect(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight))
    lines.push(`PDF: ${formatSize(match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)}`)
    lines.push(`STEP: ${formatSize(part.width, part.height)}`)
    if (dimensionChoice.mismatchPercent !== null) {
      lines.push(`Максимальное расхождение: ${formatPercent(dimensionChoice.mismatchPercent)}`)
    }
    lines.push(`Расхождение площади: ${formatPercent(areaDiff)}, сторон: ${formatPercent(aspectDiff)}`)
    if (dimensionChoice.possibleFoldedView) {
      lines.push(POSSIBLE_FOLDED_VIEW_HINT)
    }
    lines.push('')
    lines.push('Размеры детали будут заменены значениями из чертежа.')
  }

  if (part && typeof part.thickness === 'number' && typeof match.suggestedThickness === 'number') {
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

function partTypeLabel(type: PartType | null | undefined) {
  switch (type) {
    case 'SHEET':
      return 'Листовая'
    case 'PROFILE':
      return 'Профиль'
    case 'PURCHASED':
      return 'Покупная'
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
      match.suggestedPartType ||
      match.suggestedUnfoldingWidth ||
      match.suggestedUnfoldingHeight ||
      typeof match.suggestedIsSheetMetal === 'boolean' ||
      typeof match.suggestedHasBends === 'boolean'
  )
}
