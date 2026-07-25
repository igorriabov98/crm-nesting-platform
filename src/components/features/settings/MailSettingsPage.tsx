'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Clipboard, ExternalLink, Mail, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { saveMailSettings, testMailSettings } from '@/lib/actions/mail-settings'

type MailSettingsView = {
  googleProjectId: string
  clientId: string
  clientSecretPreview: string | null
  pubsubTopic: string
  configured: boolean
}

export function MailSettingsPage({ initial, appUrl }: { initial: MailSettingsView; appUrl: string }) {
  const [values, setValues] = useState({
    googleProjectId: initial.googleProjectId,
    clientId: initial.clientId,
    clientSecret: '',
    pubsubTopic: initial.pubsubTopic,
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const callbackUrl = useMemo(() => `${appUrl}/api/mail/oauth/callback`, [appUrl])
  const webhookUrl = useMemo(() => `${appUrl}/api/mail/pubsub`, [appUrl])

  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
    toast.success('Скопировано')
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await saveMailSettings(values)
    setSaving(false)
    if (!result.success) return toast.error(result.error)
    setValues((current) => ({ ...current, clientSecret: '' }))
    toast.success('Настройки Gmail сохранены')
  }

  async function test() {
    setTesting(true)
    const result = await testMailSettings(values)
    setTesting(false)
    if (!result.success) return toast.error(result.error)
    toast.success(result.message)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
            <Mail className="size-5" />
            Настройки почты
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {initial.configured ? (
            <><CheckCircle2 className="size-5 text-emerald-600" /> Gmail API настроен. Сотрудники могут подключать личные аккаунты.</>
          ) : (
            <><ShieldCheck className="size-5 text-amber-600" /> Заполните параметры приложения Google Cloud.</>
          )}
        </CardContent>
      </Card>

      <form onSubmit={save}>
        <Card>
          <CardHeader><CardTitle className="text-lg">Google Cloud и OAuth</CardTitle></CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Google Cloud Project ID *">
              <Input value={values.googleProjectId} onChange={(event) => setValues({ ...values, googleProjectId: event.target.value })} required />
            </Field>
            <Field label="OAuth Client ID *">
              <Input value={values.clientId} onChange={(event) => setValues({ ...values, clientId: event.target.value })} required />
            </Field>
            <Field label={initial.clientSecretPreview ? 'OAuth Client Secret (оставьте пустым, чтобы не менять)' : 'OAuth Client Secret *'}>
              <Input type="password" autoComplete="new-password" value={values.clientSecret} onChange={(event) => setValues({ ...values, clientSecret: event.target.value })} />
            </Field>
            <Field label="Gmail Pub/Sub topic *">
              <Input value={values.pubsubTopic} onChange={(event) => setValues({ ...values, pubsubTopic: event.target.value })} placeholder="projects/my-project/topics/gmail-crm" required />
            </Field>
            <UrlField label="Authorized redirect URI" value={callbackUrl} onCopy={copy} />
            <UrlField label="Pub/Sub push endpoint" value={webhookUrl} onCopy={copy} />
            <div className="md:col-span-2 rounded-xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
              В Google Cloud включите Gmail API и Pub/Sub API. Для OAuth consent screen добавьте scopes:
              <code className="ml-1 break-all text-foreground">gmail.modify, gmail.compose, gmail.send, gmail.labels, openid, email</code>.
              Для topic выдайте право публикации сервисному аккаунту Gmail API.
            </div>
            <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
              <LoadingButton type="button" variant="outline" loading={testing} onClick={() => void test()}>Проверить</LoadingButton>
              <LoadingButton type="submit" loading={saving}>Сохранить</LoadingButton>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function UrlField({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => Promise<void> }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" aria-label={`Скопировать ${label}`} onClick={() => void onCopy(value)}>
          <Clipboard className="size-4" />
        </Button>
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="inline-flex size-10 items-center justify-center rounded-md border">
          <ExternalLink className="size-4" />
        </a>
      </div>
    </Field>
  )
}
