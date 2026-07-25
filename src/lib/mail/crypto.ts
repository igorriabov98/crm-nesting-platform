import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function encryptionKey() {
  const configured = process.env.MAIL_TOKEN_ENCRYPTION_KEY
  if (!configured || configured.length < 32) {
    throw new Error('MAIL_TOKEN_ENCRYPTION_KEY не настроен или слишком короткий')
  }
  return createHash('sha256').update(configured).digest()
}

export function encryptMailSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptMailSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Некорректный формат защищённого секрета')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null
  return `••••••••${value.slice(-4)}`
}
