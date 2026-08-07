# Архив файлов Supabase → Google Drive

## Безопасный выпуск

1. Применить `20260807120000_file_archive_google_drive.sql` до выпуска CRM и nesting-service.
2. В Google Cloud включить Drive API и добавить callback:
   `https://<crm-domain>/api/file-archive/oauth/callback`.
3. OAuth-приложение использует существующие Client ID/Secret из настроек почты и scopes
   `openid`, `email`, `drive.file` с offline-доступом. Refresh/access tokens хранятся в Supabase Vault.
4. Выпустить CRM и Railway из одного SHA. `file-archive-worker` — четвёртый процесс PM2.
5. Открыть «Настройки → Архив файлов», подключить тестовый My Drive и включить только один безопасный тип.
6. Проверить один файл старше 60 дней: Drive-копию, сохранение Supabase-оригинала и состояние `pending_delete`.
7. Исторические файлы переносить только через «Построить preview истории» и отдельное подтверждение snapshot.

## Инварианты

- Worker удаляет бинарный объект только через Supabase Storage API и только после повторной проверки Drive ID и размера.
- Неуспешная OAuth/Drive/сетевая проверка переводит файл в `failed`; оригинал не удаляется.
- `crm-file://<asset-id>` и прежние `supabase://bucket/path` разрешаются provider-aware в nesting-service.
- Старое подключение становится `read_only`, но его Vault-токены остаются для чтения уже архивированных файлов.
- Drive folder path фиксируется в `archived_path` в момент переноса и не меняется вслед за `production_month`.
- Все пользовательские download URL и проверки прав остаются прежними; токены Google не передаются браузеру.

## Структура Drive

- С машиной: `CRM Archive / YYYY / MM Месяц / Машина [короткий ID] / Категория`.
- Без машины: `CRM Archive / Без привязки / YYYY / MM Месяц / Объект / Категория`.

Folder ID кэшируются в `file_archive_folders`; файлы и папки получают `appProperties`, поэтому повторный job не создаёт дубликаты.
