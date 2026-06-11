'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROUTES } from '@/lib/constants/routes'
import type { AIAnalysisResponse, AIMatchResult, AIStatus, NestingPart } from '@/lib/nesting/api'

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

  const partsById = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts])
  const selectableMatches = useMemo(() => {
    return (analysis?.matches || []).filter((match) => hasSuggestion(match) && !match.autoApplied)
  }, [analysis])

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
  }, [hasPdf, projectId])

  async function loadSpecification() {
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
          .filter((match) => hasSuggestion(match) && !match.autoApplied)
          .map((match) => [match.partId, true])
      ))
    } catch (error) {
      setSpecificationError(error instanceof Error ? error.message : 'Не удалось загрузить PDF-спецификацию')
    } finally {
      setIsLoadingSpecification(false)
    }
  }

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
          .filter((match) => hasSuggestion(match) && !match.autoApplied)
          .map((match) => [match.partId, true])
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
    const payload = selectableMatches
      .filter((match) => selected[match.partId])
      .map((match) => ({
        partId: match.partId,
        material: match.suggestedMaterial || undefined,
        steelTypeId: match.suggestedSteelTypeId || undefined,
        steelTypeName: match.suggestedSteelTypeName || undefined,
        steelTypeRaw: match.suggestedSteelTypeRaw || undefined,
        quantity: match.suggestedQuantity || undefined,
      }))

    if (payload.length === 0) {
      toast.error('Выберите хотя бы одно предложение AI')
      return
    }

    setIsApplying(true)
    try {
      const res = await fetch(`/api/nesting/ai/apply/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: payload }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось применить предложения AI')
      }

      await onReloadParts()
      await loadSpecification()
      setSelected({})
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

                <div className="overflow-x-auto rounded-lg border border-[#E8ECF0]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F8F9FA]">
                        <TableHead>Деталь</TableHead>
                        <TableHead>BOM совпал</TableHead>
                        <TableHead>Материал</TableHead>
                        <TableHead>Тип стали</TableHead>
                        <TableHead>Кол-во</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Принять</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.matches.map((match) => {
                        const part = partsById.get(match.partId)
                        const confidence = Math.round(match.matchConfidence * 100)
                        const canSelect = hasSuggestion(match) && !match.autoApplied

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
                                  {confidence}% · {match.bomPosition || match.bomName}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedMaterial
                                ? match.autoApplied ? `Применено: ${match.suggestedMaterial}` : `${part?.material || '—'} → ${match.suggestedMaterial}`
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {match.steelTypeWarning ? (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <AlertTriangle className="h-4 w-4" />
                                  {match.steelTypeWarning}
                                </span>
                              ) : match.suggestedSteelTypeName ? (
                                match.autoApplied ? `Применено: ${match.suggestedSteelTypeName}` : `${part?.steelTypeName || '—'} → ${match.suggestedSteelTypeName}`
                              ) : match.suggestedSteelTypeRaw ? (
                                match.suggestedSteelTypeRaw
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {match.suggestedQuantity
                                ? match.autoApplied ? `Применено: ${match.suggestedQuantity}` : `${part?.quantity || '—'} → ${match.suggestedQuantity}`
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {match.autoApplied ? (
                                <Badge className="bg-emerald-100 text-emerald-700">Применено автоматически</Badge>
                              ) : match.steelTypeWarning ? (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Нужен ручной тип стали</Badge>
                              ) : hasSuggestion(match) ? (
                                <Badge variant="outline">Есть предложение</Badge>
                              ) : (
                                <span className="text-[#6B7280]">Без изменений</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {canSelect ? (
                                <Checkbox
                                  checked={selected[match.partId] === true}
                                  onCheckedChange={(checked) => setSelected((current) => ({ ...current, [match.partId]: checked === true }))}
                                />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {analysis.unmatchedBom.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">Строки PDF без детали в STEP: {analysis.unmatchedBom.length}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysis.unmatchedBom.slice(0, 8).map((entry, index) => (
                        <Badge key={`${entry.position}-${entry.name}-${index}`} variant="outline" className="bg-white">
                          {[entry.position, entry.name, entry.steelTypeName || entry.steelTypeRaw].filter(Boolean).join(' · ')}
                        </Badge>
                      ))}
                      {analysis.unmatchedBom.length > 8 && <span>ещё {analysis.unmatchedBom.length - 8}</span>}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applySelected} disabled={isApplying || selectableMatches.length === 0}>
                    {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Применить выбранные
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelected({})}>
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

function hasSuggestion(match: AIMatchResult) {
  return Boolean(match.suggestedMaterial || match.suggestedQuantity || match.suggestedSteelTypeId)
}
