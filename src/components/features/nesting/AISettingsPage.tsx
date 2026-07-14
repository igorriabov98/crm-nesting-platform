'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Eye, EyeOff, RefreshCw, Save, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePermissions } from '@/components/providers/PermissionProvider'
import type { AISettings, AIUsageHistoryItem } from '@/lib/nesting/api'

const models = [
  {
    value: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    description: 'Рекомендуемая (новейшая). Лучшее качество чтения чертежей.',
  },
  {
    value: 'anthropic/claude-sonnet-4-20250514',
    label: 'anthropic/claude-sonnet-4-20250514',
    description: 'Рекомендуемая модель для чтения производственных чертежей.',
  },
  {
    value: 'anthropic/claude-haiku-4-5-20251001',
    label: 'anthropic/claude-haiku-4-5-20251001',
    description: 'Бюджетная модель для простых PDF и быстрых проверок.',
  },
  {
    value: 'google/gemini-2.5-flash',
    label: 'google/gemini-2.5-flash',
    description: 'Быстрая альтернатива с нативной поддержкой PDF.',
  },
]

const modelDescriptions: Record<string, string> = {
  'anthropic/claude-sonnet-4.6': 'Рекомендуемая (новейшая). Лучшее качество чтения чертежей.',
  'anthropic/claude-sonnet-4-20250514': 'Стабильная. Проверенная версия.',
  'anthropic/claude-haiku-4-5-20251001': 'Бюджетная. Дешевле в 5 раз.',
  'google/gemini-2.5-flash': 'Альтернатива. Быстрая, поддерживает PDF нативно.',
}

export function AISettingsPage({
  initialSettings,
  initialUsage,
}: {
  initialSettings: AISettings
  initialUsage: AIUsageHistoryItem[]
}) {
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can('nesting_settings', 'manage')
  const [settings, setSettings] = useState(initialSettings)
  const [usage] = useState(initialUsage)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [model, setModel] = useState(initialSettings.model)
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl)
  const [maxTokens, setMaxTokens] = useState(String(initialSettings.maxTokens))
  const [monthlyBudget, setMonthlyBudget] = useState(String(initialSettings.monthlyBudget))
  const [autoApplyResults, setAutoApplyResults] = useState(initialSettings.autoApplyResults)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()
  const [isTesting, startTesting] = useTransition()

  const budgetPercent = useMemo(() => {
    if (settings.monthlyBudget <= 0) return 0
    return Math.min(100, Math.round((settings.currentMonthUsage / settings.monthlyBudget) * 100))
  }, [settings.currentMonthUsage, settings.monthlyBudget])

  function saveSettings() {
    setTestResult(null)
    startSaving(async () => {
      try {
        const res = await fetch('/api/nesting/ai/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: apiKey.trim() || undefined,
            model,
            baseUrl,
            maxTokens: Number(maxTokens),
            monthlyBudget: Number(monthlyBudget),
            autoApplyResults,
          }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          throw new Error(data.error || 'Не удалось сохранить настройки AI')
        }

        setSettings(data as AISettings)
        setApiKey('')
        toast.success('Настройки AI сохранены')
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось сохранить настройки AI')
      }
    })
  }

  function testConnection() {
    setTestResult(null)
    startTesting(async () => {
      try {
        const res = await fetch('/api/nesting/ai/test', { method: 'POST' })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'OpenRouter не подтвердил подключение')
        }

        setTestResult(`Подключено. Модель: ${data.model}`)
        toast.success('Подключение к OpenRouter работает')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось проверить подключение'
        setTestResult(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-5">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Настройки AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-[#1B3A6B]">Подключение к OpenRouter</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="openrouter-key">API ключ</Label>
                <div className="flex gap-2">
                  <Input
                    id="openrouter-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={settings.hasApiKey ? 'sk-or-••••••••••••••••' : 'sk-or-...'}
                    autoComplete="off"
                    className="bg-white font-mono"
                    disabled={!canManage}
                  />
                  <Button type="button" variant="outline" onClick={() => setShowApiKey((value) => !value)}>
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {settings.hasApiKey ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      API ключ настроен
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                      <XCircle className="mr-1 h-3.5 w-3.5" />
                      API ключ не настроен
                    </Badge>
                  )}
                  {testResult && <span className="text-[#374151]">{testResult}</span>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Модель</Label>
                <Select value={model} disabled={!canManage} onValueChange={(value) => value && setModel(value)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue>{models.find((item) => item.value === model)?.label ?? model}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {models.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openrouter-base-url">Base URL</Label>
                <Input
                  id="openrouter-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="bg-white"
                  disabled={!canManage}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="openrouter-max-tokens">Макс. токенов на запрос</Label>
                <Input
                  id="openrouter-max-tokens"
                  type="number"
                  min={100}
                  max={128000}
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(event.target.value)}
                  className="bg-white"
                  disabled={!canManage}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="openrouter-budget">Месячный лимит, $</Label>
                <Input
                  id="openrouter-budget"
                  type="number"
                  min={0}
                  step={1}
                  value={monthlyBudget}
                  onChange={(event) => setMonthlyBudget(event.target.value)}
                  className="bg-white"
                  disabled={!canManage}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E8ECF0] p-3 lg:col-span-2">
                <div className="space-y-1">
                  <Label htmlFor="ai-auto-apply">Автоприменение AI-результатов</Label>
                  <p className="text-sm text-[#6B7280]">ON сохраняет текущий флоу; OFF оставляет строки в статусе «Предложено».</p>
                </div>
                <Switch
                  id="ai-auto-apply"
                  checked={autoApplyResults}
                  disabled={!canManage}
                  onCheckedChange={(checked) => setAutoApplyResults(checked === true)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={saveSettings} disabled={!canManage || isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
              <Button type="button" variant="outline" onClick={testConnection} disabled={!canManage || isTesting || !settings.hasApiKey}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {isTesting ? 'Проверка...' : 'Проверить подключение'}
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Бюджет и лимиты</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Потрачено в этом месяце: ${settings.currentMonthUsage.toFixed(2)} / ${settings.monthlyBudget.toFixed(2)}</span>
            <span>{budgetPercent}%</span>
          </div>
          <Progress value={budgetPercent} indicatorClassName={settings.budgetWarning ? 'bg-red-600' : 'bg-[#1B3A6B]'} />
          {settings.budgetWarning && (
            <p className="text-sm text-red-600">Месячный бюджет превышен. Анализ PDF не блокируется, но расходы требуют проверки.</p>
          )}
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-lg border border-[#E8ECF0] p-3">Запросов за месяц: {settings.currentMonthRequests}</div>
            <div className="rounded-lg border border-[#E8ECF0] p-3">Всего запросов: {settings.totalRequests}</div>
            <div className="rounded-lg border border-[#E8ECF0] p-3">Средняя стоимость: ${settings.averageRequestCost.toFixed(4)}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>История использования</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Проект</TableHead>
                  <TableHead>Модель</TableHead>
                  <TableHead>Токены</TableHead>
                  <TableHead>Стоимость</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-[#6B7280]">История пока пустая</TableCell>
                  </TableRow>
                ) : usage.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDate(item.createdAt)}</TableCell>
                    <TableCell>{item.orderNumber}</TableCell>
                    <TableCell className="max-w-[260px] truncate">{item.model}</TableCell>
                    <TableCell>{item.tokensUsed}</TableCell>
                    <TableCell>${item.cost.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Доступные модели</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[#374151]">
          {models.map((item) => (
            <div key={item.value}>
              <div className="font-medium text-[#1B3A6B]">{item.label}</div>
              <div>{modelDescriptions[item.value] ?? item.description}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
