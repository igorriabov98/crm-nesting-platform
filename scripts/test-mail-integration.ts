import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { gmailLabelChanges, mergeMailThreadPages } from '../src/lib/mail/model'
import { getNotificationDestination } from '../src/components/features/notifications/notification-model'
import type { MailThreadListItem } from '../src/lib/mail/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  inferProductProjectFileKind,
  PRODUCT_PROJECT_FILE_MAX_BYTES,
  validateProductProjectFile,
} from '../src/lib/products/product-project-file-upload'
import { getErrorMessage } from '../src/lib/utils/get-error-message'
import { z } from 'zod'

function thread(index: number): MailThreadListItem {
  return {
    id: `thread-${index}`,
    gmail_thread_id: `gmail-${index}`,
    subject: `Тема ${index}`,
    snippet: `Текст ${index}`,
    participants: [{ email: `sender-${index}@example.com` }],
    label_ids: ['INBOX'],
    last_message_at: new Date(Date.UTC(2026, 6, 25, 12, 0, 0) - index * 1000).toISOString(),
    message_count: 1,
    is_unread: index % 2 === 0,
    is_starred: false,
    has_attachments: false,
  }
}

assert.deepEqual(gmailLabelChanges.archive, { removeLabelIds: ['INBOX'] })
assert.deepEqual(gmailLabelChanges.trash, {
  addLabelIds: ['TRASH'],
  removeLabelIds: ['INBOX', 'SPAM'],
})

const first = Array.from({ length: 5_000 }, (_, index) => thread(index))
const second = Array.from({ length: 5_000 }, (_, index) => thread(index + 4_500))
const started = performance.now()
const merged = mergeMailThreadPages(first, second)
const elapsed = performance.now() - started
assert.equal(merged.length, 9_500, 'pagination merge must deduplicate overlapping Gmail pages')
assert.equal(merged[0].id, 'thread-0', 'newest thread must remain first')
assert.ok(elapsed < 250, `10k-page merge exceeded performance budget: ${elapsed.toFixed(1)} ms`)

const destination = getNotificationDestination({
  id: 'notification-1',
  type: 'mail_received',
  title: 'Новое письмо',
  message: 'Проверка',
  created_at: new Date().toISOString(),
  is_read: false,
  related_machine_id: null,
  consumable_request_id: null,
  related_mail_thread_id: 'thread-42',
})
assert.equal(destination?.href, '/mail?thread=thread-42')

const crmLinksMigration = readFileSync(
  resolve('supabase/migrations/20260727225500_mail_crm_entity_links.sql'),
  'utf8',
)
for (const table of [
  'department_request_mail_threads',
  'department_request_mail_messages',
  'product_project_mail_messages',
]) {
  assert.match(crmLinksMigration, new RegExp(`create table public\\.${table}`))
  assert.match(crmLinksMigration, new RegExp(`alter table public\\.${table} enable row level security`))
}
assert.match(crmLinksMigration, /create_department_request_with_mail/)
assert.match(crmLinksMigration, /account\.user_id = current_user_id/)
assert.match(crmLinksMigration, /unlinked_at is null/)

const mailActions = readFileSync(resolve('src/lib/actions/mail.ts'), 'utf8')
assert.match(mailActions, /getOwnedMailLinkPreview/)
assert.match(mailActions, /linkMailToProductProject/)
assert.match(mailActions, /getDepartmentRequestMailLinks/)
assert.match(mailActions, /parsedMessageId/)
assert.match(mailActions, /link_mail_to_product_project_v2/)
assert.match(mailActions, /p_version_id/)

const projectMailMigration = readFileSync(
  resolve('supabase/migrations/20260906120000_product_project_mail_versions.sql'),
  'utf8',
)
for (const helper of [
  'current_user_owns_mail_thread',
  'current_user_owns_mail_message',
  'create_product_project_with_mail_v2',
  'request_product_project_correction_v2',
]) {
  assert.match(projectMailMigration, new RegExp(`function public\\.${helper}`, 'i'))
}
assert.match(projectMailMigration, /SET search_path = ''/)
assert.match(projectMailMigration, /product_project_mail_threads_project_version_fkey/)
assert.match(projectMailMigration, /product_project_mail_messages_project_version_fkey/)
assert.match(projectMailMigration, /correction_note/)
assert.match(projectMailMigration, /CREATE OR REPLACE FUNCTION public\.create_department_request_with_mail/)

const mailCrmUi = readFileSync(resolve('src/components/features/mail/MailCrmActions.tsx'), 'utf8')
assert.match(mailCrmUi, /Использовать в CRM/)
assert.match(mailCrmUi, /Всю цепочку/)
assert.match(mailCrmUi, /Только письмо/)
assert.match(mailCrmUi, /min-h-11/)
assert.match(mailCrmUi, /correctionMailKind/)
assert.match(mailCrmUi, /Корректировка/)
assert.match(mailCrmUi, /overflow-x-hidden overflow-y-auto/)

const picker = readFileSync(resolve('src/components/features/mail/MailThreadPicker.tsx'), 'utf8')
assert.match(picker, /min-w-0/)
assert.match(picker, /overflow-x-hidden/)
assert.match(picker, /maxSelected/)

assert.equal(inferProductProjectFileKind('drawing.DXF'), 'drawing')
assert.equal(inferProductProjectFileKind('model.step'), 'step')
assert.equal(inferProductProjectFileKind('photo.webp'), 'photo')
assert.equal(inferProductProjectFileKind('offer.pdf'), 'pdf')
assert.doesNotThrow(() => validateProductProjectFile({ fileName: 'presentation.pptx', fileSize: 100 }))
assert.throws(() => validateProductProjectFile({ fileName: 'virus.exe', fileSize: 100 }), /не поддерживается/)
assert.throws(() => validateProductProjectFile({ fileName: 'large.dwg', fileSize: PRODUCT_PROJECT_FILE_MAX_BYTES + 1 }), /50 МБ/)

assert.equal(
  getErrorMessage({ message: 'infinite recursion detected in policy for relation "mail_threads"', code: '42P17' }),
  'Не удалось сохранить связь. Обновите страницу и повторите попытку',
)
assert.equal(
  getErrorMessage({ message: 'invalid input syntax for type uuid', code: '22P02' }),
  'Проверьте выбранные данные и повторите попытку',
)
const invalidUuid = z.string().uuid('Выберите корректные данные').safeParse('')
assert.equal(invalidUuid.success, false)
if (!invalidUuid.success) {
  assert.equal(getErrorMessage(invalidUuid.error), 'Выберите корректные данные')
}

console.log(`mail integration checks passed; 9,500 unique threads merged in ${elapsed.toFixed(1)} ms`)
