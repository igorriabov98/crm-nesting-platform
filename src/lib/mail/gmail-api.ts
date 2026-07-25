import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Buffer } from 'node:buffer'
import sanitizeHtml from 'sanitize-html'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMailSettings } from './config'
import { readMailVaultSecret, storeMailVaultSecret } from './vault'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

type MailAccount = {
  id: string
  user_id: string
  email_address: string
  access_token_vault_id: string | null
  refresh_token_vault_id: string | null
  token_expires_at: string | null
  gmail_history_id: string | null
}

async function refreshAccessToken(account: MailAccount) {
  const settings = await requireMailSettings()
  if (!account.refresh_token_vault_id) throw new Error('Gmail отключён. Подключите аккаунт снова.')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      refresh_token: await readMailVaultSecret(account.refresh_token_vault_id),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  const payload = await response.json()
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || 'Google отклонил обновление доступа')
  const expiresAt = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString()
  const accessTokenVaultId = await storeMailVaultSecret({
    secretId: account.access_token_vault_id,
    secret: payload.access_token,
    name: `gmail-access-${account.user_id}`,
    description: `Gmail access token for CRM user ${account.user_id}`,
  })
  await (createAdminClient() as any).from('mail_accounts').update({
    access_token_vault_id: accessTokenVaultId,
    token_expires_at: expiresAt,
    sync_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id)
  return payload.access_token as string
}

export async function getAccessToken(account: MailAccount) {
  if (
    account.access_token_vault_id
    && account.token_expires_at
    && new Date(account.token_expires_at).getTime() > Date.now() + 60_000
  ) {
    return readMailVaultSecret(account.access_token_vault_id)
  }
  return refreshAccessToken(account)
}

export async function gmailFetch<T>(
  account: MailAccount,
  path: string,
  init?: RequestInit,
) {
  const accessToken = await getAccessToken(account)
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  })
  if (response.status === 204) return null as T
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || `Gmail API: HTTP ${response.status}`)
  return payload as T
}

export function decodeBase64Url(value?: string) {
  return value ? Buffer.from(value, 'base64url').toString('utf8') : ''
}

export function sanitizeMailHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'name', 'target', 'rel'],
      img: ['alt', 'width', 'height', 'data-external-src'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
      img: (_tagName, attributes) => {
        const src = attributes.src || ''
        if (/^https?:/i.test(src)) {
          return { tagName: 'span', attribs: { 'data-blocked-image': src } }
        }
        return { tagName: 'img', attribs: attributes }
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'cid'],
  })
}

export function buildRawMessage(input: {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  inReplyTo?: string
  references?: string
}) {
  const headers = [
    `To: ${input.to.join(', ')}`,
    input.cc?.length ? `Cc: ${input.cc.join(', ')}` : null,
    input.bcc?.length ? `Bcc: ${input.bcc.join(', ')}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString('base64')}?=`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.references ? `References: ${input.references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.text).toString('base64'),
  ].filter((value): value is string => value !== null)
  return Buffer.from(headers.join('\r\n')).toString('base64url')
}

export type GmailAccountRow = MailAccount
