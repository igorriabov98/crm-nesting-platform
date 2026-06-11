'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Copy, Send, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ROLES } from '@/lib/constants/roles'
import {
  deleteTelegramToken,
  saveTelegramToken,
  sendTestMessage,
  type TelegramUserRow,
} from '@/lib/actions/telegram-settings'

type TelegramSettingsPageProps = {
  status: {
    configured: boolean
    tokenPreview: string | null
    tokenSource: 'database' | 'env' | null
    botUsername: string | null
    error: string | null
  }
  users: TelegramUserRow[]
}

export function TelegramSettingsPage({ status, users }: TelegramSettingsPageProps) {
  const router = useRouter()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const testUsers = useMemo(() => users.filter((user) => !!user.telegram_chat_id), [users])

  const saveToken = () => {
    setResult(null)
    startTransition(async () => {
      const response = await saveTelegramToken(tokenInput)
      if (response.success) {
        setTokenInput('')
        toast.success(response.botUsername ? `Бот подключен: @${response.botUsername}` : 'Токен сохранен')
        router.refresh()
      } else {
        toast.error(response.error || 'Не удалось сохранить токен')
      }
    })
  }

  const removeToken = () => {
    if (!window.confirm('Удалить токен Telegram из настроек CRM?')) return
    setResult(null)
    startTransition(async () => {
      const response = await deleteTelegramToken()
      if (response.success) {
        toast.success('Токен удален из CRM')
        router.refresh()
      } else {
        toast.error(response.error || 'Не удалось удалить токен')
      }
    })
  }

  const sendTest = () => {
    if (!selectedUserId) return
    setResult(null)
    startTransition(async () => {
      const response = await sendTestMessage(selectedUserId)
      if (response.success) {
        setResult('Сообщение доставлено')
        toast.success('Тестовое сообщение отправлено')
      } else {
        const message = response.error || 'Не удалось отправить сообщение'
        setResult(`Ошибка: ${message}`)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1B3A6B]/10 text-[#1B3A6B]">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1B3A6B]">Настройки Telegram-бота</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {status.configured && status.botUsername ? (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Подключен (@{status.botUsername})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    {status.configured ? 'Токен задан, но проверка не прошла' : 'Не настроен'}
                  </Badge>
                )}
                {status.error && <span className="text-[#DC2626]">{status.error}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
          <div className="text-sm font-medium text-[#374151]">Telegram Bot Token</div>
          <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <Input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="123456789:ABCDEF..."
              className="bg-white font-mono"
              autoComplete="off"
            />
            <Button type="button" onClick={saveToken} disabled={!tokenInput.trim() || isPending}>
              Сохранить токен
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={removeToken}
              disabled={isPending || status.tokenSource !== 'database'}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить
            </Button>
          </div>

          <div className="mt-3 rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#374151]">
            Текущий токен: <span className="font-mono text-[#1B3A6B]">{status.tokenPreview || 'не задан'}</span>
            {status.tokenSource === 'database' && <span className="ml-2 text-emerald-700">хранится в CRM</span>}
            {status.tokenSource === 'env' && <span className="ml-2 text-amber-700">взят из переменных окружения</span>}
          </div>

          <p className="mt-2 text-sm text-[#6B7280]">
            Введите токен от @BotFather прямо здесь. CRM сохранит его в защищенных настройках базы.
            Переменная TELEGRAM_BOT_TOKEN остается только резервным способом для администраторов сервера.
          </p>
        </div>
      </section>

      <InstructionBlock />

      {status.configured && (
        <>
          <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Подключенные пользователи</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E8ECF0] text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2">Имя</th>
                    <th className="px-3 py-2">Роль</th>
                    <th className="px-3 py-2">Telegram ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8ECF0]">
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-3 py-2 font-medium text-[#1B3A6B]">{user.full_name}</td>
                      <td className="px-3 py-2 text-[#374151]">{ROLES[user.role]?.label || user.role}</td>
                      <td className="px-3 py-2 text-[#374151]">
                        {user.telegram_chat_id ? `${user.telegram_chat_id} - заполнен` : 'не заполнен'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Тестовое уведомление</h2>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="h-9 min-w-[260px] rounded-md border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B3A6B]"
              >
                <option value="">Выберите пользователя</option>
                {testUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} · {ROLES[user.role]?.label || user.role}
                  </option>
                ))}
              </select>
              <Button onClick={sendTest} disabled={!selectedUserId || isPending}>
                <Send className="mr-2 h-4 w-4" />
                Отправить тестовое сообщение
              </Button>
            </div>
            {result && <div className="mt-3 text-sm text-[#374151]">{result}</div>}
          </section>
        </>
      )}
    </div>
  )
}

function InstructionBlock() {
  return (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
      <h2 className="text-lg font-semibold text-[#1B3A6B]">Инструкция по настройке</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#374151]">
        <li>Откройте Telegram и найдите @BotFather.</li>
        <li>Отправьте команду /newbot.</li>
        <li>Придумайте имя бота и username.</li>
        <li>Скопируйте токен вида 123456789:ABCDEF...</li>
        <li>Вставьте токен в поле выше и нажмите “Сохранить токен”.</li>
        <li>В профилях пользователей укажите Telegram Chat ID.</li>
      </ol>

      <div className="mt-5 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
        <h3 className="font-semibold text-[#1B3A6B]">Как узнать Telegram Chat ID пользователя</h3>
        <div className="mt-2 space-y-2 text-sm text-[#374151]">
          <p>Способ 1: пользователь открывает @userinfobot, нажимает Start и копирует Chat ID.</p>
          <p>Способ 2: пользователь открывает @RawDataBot, отправляет сообщение и берет значение chat.id.</p>
          <p>Скопированный ID вставьте в профиль пользователя в /admin/users.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => navigator.clipboard?.writeText('TELEGRAM_BOT_TOKEN=\\nNEXT_PUBLIC_APP_URL=http://localhost:3000')}
        >
          <Copy className="mr-2 h-4 w-4" />
          Скопировать env-шаблон для резервной настройки
        </Button>
      </div>
    </section>
  )
}
