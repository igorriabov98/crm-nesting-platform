база: origin/main 597f645d2d9bccf9102ea91ec9cae434f1748f59

# Анализ текущей CRM перед версионированием продуктов

Задача выполнена как read-only анализ кодовой базы перед будущей функциональностью версий продукта. В коде, миграциях и настройках изменения не вносились; создан только этот документ.

Важно о состоянии checkout: анализ выполнен по текущей рабочей ветке `fix-hidden-bodies` на `HEAD c5fa9ebdebd5f74c97a11821e8b4db007548a7d9`. После повторного `fetch` текущий `origin/main` стал `597f645d2d9bccf9102ea91ec9cae434f1748f59`, а текущий checkout является его предком. Merge/rebase не выполнялся, потому что задача была read-only.

## 1. Стек

- Основное приложение написано на TypeScript: `package.json` содержит Next.js `16.2.9`, React `19.2.4`, TypeScript, Zod, Supabase JS/SSR и `@react-pdf/renderer` для PDF-документов (`package.json:16-40`, `package.json:42-52`).
- Основной доступ к БД в CRM идет через Supabase JS query builder, например `.from('products')`, `.select(...)`, `.insert(...)` в server actions продукции (`src/lib/actions/products.ts:417-528`, `src/lib/actions/products.ts:553-644`).
- СУБД: PostgreSQL через Supabase. SQL-миграции лежат в `supabase/migrations`; root-скрипт миграций `supabase:migrate` запускает `tsx scripts/apply-supabase-migrations.ts` (`package.json:5-14`).
- Отдельный `nesting-service` написан на TypeScript/Fastify, использует Prisma ORM, Supabase client, pg-boss, occt-import-js/opencascade.js и pdf-parse (`nesting-service/package.json:26-42`).
- Prisma в `nesting-service` настроена на PostgreSQL datasource `DATABASE_URL` и schema `nesting` (`nesting-service/prisma/schema.prisma:1-9`).
- Хранилище файлов: Supabase Storage. Для карточек продукта и ряда CRM-файлов используется bucket `product-files`; для самостоятельных загрузок раскроя используется bucket `nesting-files` (`supabase/migrations/103_product_catalog_and_projects.sql:111-113`, `supabase/migrations/20260618000000_nesting_storage.sql:1-6`).

## 2. Текущая модель продукта

### 2.1 `products`

Таблица каталожного продукта создается в `supabase/migrations/103_product_catalog_and_projects.sql:3-19`.

| Поле | Тип / ограничение | Факт |
| --- | --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` | Идентификатор продукта (`supabase/migrations/103_product_catalog_and_projects.sql:3-4`). |
| `name_uk` | `text not null` | Название на украинском (`supabase/migrations/103_product_catalog_and_projects.sql:5`). |
| `name_en` | `text not null` | Название на английском (`supabase/migrations/103_product_catalog_and_projects.sql:6`). |
| `uktzed` | `text not null` | Код УКТЗЕД (`supabase/migrations/103_product_catalog_and_projects.sql:7`). |
| `drawing_number` | `text not null` | Номер чертежа (`supabase/migrations/103_product_catalog_and_projects.sql:8`). |
| `characteristics` | `text not null default ''` | Описание/характеристики (`supabase/migrations/103_product_catalog_and_projects.sql:9`). |
| `unit_weight_kg` | `numeric not null check > 0` | Вес единицы (`supabase/migrations/103_product_catalog_and_projects.sql:10`). |
| `base_price_eur` | `numeric not null default 0 check >= 0` | Базовая цена (`supabase/migrations/103_product_catalog_and_projects.sql:11`). |
| `status` | `text not null default 'draft' check in draft/active/archived` | Состояние продукта (`supabase/migrations/103_product_catalog_and_projects.sql:12`). |
| `source_project_id` | `uuid`, FK на `product_projects(id)` `on delete set null` | Связь с проектом изделия, из которого создан продукт (`supabase/migrations/103_product_catalog_and_projects.sql:13`, `supabase/migrations/103_product_catalog_and_projects.sql:87-89`). |
| `source_version_id` | `uuid`, FK на `product_project_versions(id)` `on delete set null` | Связь с утвержденной версией проекта изделия, не история версий самого продукта (`supabase/migrations/103_product_catalog_and_projects.sql:14`, `supabase/migrations/103_product_catalog_and_projects.sql:87-89`). |
| `created_by` | `uuid references users(id)` | Автор создания (`supabase/migrations/103_product_catalog_and_projects.sql:15`). |
| `updated_by` | `uuid references users(id)` | Автор последнего изменения (`supabase/migrations/103_product_catalog_and_projects.sql:16`). |
| `created_at` | `timestamptz not null default now()` | Дата создания (`supabase/migrations/103_product_catalog_and_projects.sql:17`). |
| `updated_at` | `timestamptz not null default now()` | Дата изменения (`supabase/migrations/103_product_catalog_and_projects.sql:18`). |

Индексы и ограничения:

- `idx_products_status` на `status` (`supabase/migrations/103_product_catalog_and_projects.sql:99`).
- GIN trigram индексы `idx_products_name_uk_trgm`, `idx_products_name_en_trgm` на названиях (`supabase/migrations/103_product_catalog_and_projects.sql:100-101`).
- `idx_products_uktzed` на `uktzed` (`supabase/migrations/103_product_catalog_and_projects.sql:102`).
- Уникальный partial index `idx_products_source_project_unique` на `products(source_project_id)` при `source_project_id is not null` (`supabase/migrations/20260622130000_product_project_workflow.sql:59-61`).
- В сгенерированных типах Supabase таблица отражена без полей `revision`, `fastening`, `mount`, `assembly_type` или `completion_type` (`src/lib/types/database.ts:975-1027`).

### 2.2 `product_files`

Таблица файлов продукта создается в `supabase/migrations/103_product_catalog_and_projects.sql:21-31`; тип `pdf` добавлен отдельной миграцией (`supabase/migrations/106_product_file_pdf_kind.sql:1-4`).

| Поле | Тип / ограничение | Факт |
| --- | --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` | Идентификатор файла. |
| `product_id` | `uuid not null references products(id) on delete cascade` | Файл принадлежит продукту, не версии продукта (`supabase/migrations/103_product_catalog_and_projects.sql:23`). |
| `file_kind` | `text check in drawing/step/pdf/photo/other` | Тип файла (`supabase/migrations/106_product_file_pdf_kind.sql:1-4`). |
| `file_name` | `text not null` | Исходное имя файла (`supabase/migrations/103_product_catalog_and_projects.sql:25`). |
| `file_path` | `text not null` | Путь в Supabase Storage (`supabase/migrations/103_product_catalog_and_projects.sql:26`). |
| `mime_type` | `text` | MIME type (`supabase/migrations/103_product_catalog_and_projects.sql:27`). |
| `file_size` | `bigint` | Размер в байтах (`supabase/migrations/103_product_catalog_and_projects.sql:28`). |
| `uploaded_by` | `uuid references users(id)` | Кто загрузил (`supabase/migrations/103_product_catalog_and_projects.sql:29`). |
| `created_at` | `timestamptz default now()` | Дата загрузки (`supabase/migrations/103_product_catalog_and_projects.sql:30`). |

Индекс: `idx_product_files_product` на `product_files(product_id)` (`supabase/migrations/103_product_catalog_and_projects.sql:103`). В сгенерированных типах файл также привязан к `product_id`, а не к версии (`src/lib/types/database.ts:1028-1062`).

### 2.3 Проекты изделий и их версии

В кодовой базе есть отдельный workflow `product_projects` / `product_project_versions`, похожий на версионирование, но он относится к разработке нового изделия до переноса в каталог.

- `product_projects`: `id`, `title`, `client_id`, `description`, `characteristics`, `client_wishes`, `assigned_engineer_id`, `status`, `approved_version_id`, `created_by`, `updated_by`, `created_at`, `updated_at` (`supabase/migrations/103_product_catalog_and_projects.sql:33-47`, `src/lib/types/database.ts:1063-1109`).
- `product_project_versions`: `id`, `project_id`, `version_number`, `version_label`, `description`, `characteristics`, `client_wishes`, `status`, `created_by`, `created_at`, unique `(project_id, version_number)` (`supabase/migrations/103_product_catalog_and_projects.sql:49-61`).
- Позже в `product_project_versions` добавлены продуктовые поля `name_uk`, `name_en`, `uktzed`, `drawing_number`, `unit_weight_kg`, `base_price_eur` (`supabase/migrations/20260622130000_product_project_workflow.sql:27-37`, `src/lib/types/database.ts:1110-1165`).
- `product_project_files`: `id`, `project_id`, `version_id`, `file_kind`, `file_name`, `file_path`, `mime_type`, `file_size`, `uploaded_by`, `created_at`; индексируется по `project_id` и `version_id` (`supabase/migrations/103_product_catalog_and_projects.sql:70-80`, `supabase/migrations/103_product_catalog_and_projects.sql:107-108`, `src/lib/types/database.ts:1166-1203`).
- `product_projects.approved_version_id` связан с `product_project_versions(id)` (`supabase/migrations/103_product_catalog_and_projects.sql:63-68`).
- При переносе проекта в каталог `products.source_project_id` и `products.source_version_id` фиксируют происхождение продукта (`src/lib/actions/products.ts:1186-1251`, `src/lib/actions/products.ts:1328-1350`).

### 2.4 Поля продукта в позициях заказа

Сущность заказа в этой CRM называется `machines`, а строки заказа — `machine_items`.

- `machine_items` имеет прямые ссылки `product_id`, `product_project_id`, `product_project_version_id` и денормализованные поля `drawing_number`, `product_name`, `product_name_uk`, `product_name_en`, `product_uktzed`, `product_drawing_number`, `product_characteristics`, `weight`, `price`, `quantity`, `coating`, `ral_number`, `is_sample`, `sort_order` (`src/lib/types/database.ts:590-669`).
- Миграция каталога добавила в `machine_items` `product_id` и снимки продуктовых полей (`supabase/migrations/103_product_catalog_and_projects.sql:91-97`).
- Миграция product-project workflow добавила ссылки образцов `product_project_id` и `product_project_version_id` с индексами (`supabase/migrations/20260622130000_product_project_workflow.sql:49-57`).

### 2.5 Похожие механизмы на версионирование

- Для каталожного продукта есть только `updated_at`/`updated_by`; поля `revision` или таблицы `product_versions` не найдены. Поиск по `revision|product_version|product_versions` дал только `source_version_id` и использование `product_project_versions`.
- `source_version_id` у `products` указывает на утвержденную версию проекта изделия, но после промоушена продукт становится одной текущей карточкой (`supabase/migrations/103_product_catalog_and_projects.sql:13-14`, `src/lib/actions/products.ts:1186-1251`).
- Для образцов в заказе уже используется жесткая ссылка на `product_project_version_id`, но для обычных товаров строка заказа ссылается только на `product_id` (`src/app/(protected)/sales-plan/actions.ts:342-395`).
- Поля будущей функциональности `крепление` и `тип комплектации` в продуктовой схеме не найдены; найденные упоминания "комплектации" относятся к складу/снабжению, не к продукту (`src/components/features/inventory/InventoryPage.tsx:290`, `src/components/features/stock-check/StockCheckList.tsx:29`, `src/app/(protected)/supply/page.tsx:44`).

### 2.6 Хранение чертежей и STEP сейчас

- Для карточки продукта файлы хранятся как записи `product_files` с `file_path` в Supabase Storage bucket `product-files` (`supabase/migrations/103_product_catalog_and_projects.sql:21-31`, `supabase/migrations/103_product_catalog_and_projects.sql:111-113`).
- Bucket `product-files` приватный (`public=false`) и имеет `file_size_limit = 52428800` байт, то есть 50 МБ (`supabase/migrations/103_product_catalog_and_projects.sql:111-113`).
- При создании продукта server action принимает опциональные `step_file` и `pdf_file`, проверяет расширения `.step/.stp` и `.pdf`, загружает файлы в `products/{productId}/...` и создает записи `product_files` (`src/lib/actions/products.ts:553-628`).
- В UI создания продукта сейчас есть только поле `pdf_file`; поля загрузки STEP на форме создания нет (`src/components/features/products/ProductForm.tsx:51-108`, `src/components/features/products/ProductForm.tsx:152-158`).
- В менеджере файлов продукта пользователь выбирает `file_kind`, загружает один файл без `accept` на input; UI предупреждает, что новая загрузка STEP/PDF добавит еще один файл того же типа, но не блокирует дубликат (`src/components/features/products/ProductFileManager.tsx:24-46`, `src/components/features/products/ProductFileManager.tsx:72-96`).
- `uploadProductFile` проверяет enum `file_kind`, но не проверяет расширение файла по типу; файл отправляется в `product-files` (`src/lib/actions/products.ts:674-700`).
- Скачать/открыть файл можно через signed URL на 60 секунд (`src/app/api/products/files/[id]/route.ts:4-24`).

## 3. Места использования сущности продукта

### 3.1 Server actions и API каталога

| Место | Использование |
| --- | --- |
| `src/lib/actions/products.ts:417-431` | `getProductOptions`: читает активные продукты для выбора в заказе; поля: `id`, названия, `uktzed`, `drawing_number`, `characteristics`, `unit_weight_kg`, `base_price_eur`, `status`. |
| `src/lib/actions/products.ts:433-501` | `getProductProjectSampleOptions`: читает утвержденные проекты изделий и их approved version; исключает уже промоутнутые в `products`; возвращает sample option с `project_id` и `version_id`. |
| `src/lib/actions/products.ts:503-528` | `getProducts`/`getProduct`: читает `products` вместе с `product_files(*)`. |
| `src/lib/actions/products.ts:534-551` | `createProduct`: создает продукт без файлов. |
| `src/lib/actions/products.ts:553-644` | `createProductWithFiles`: создает продукт и опциональные STEP/PDF записи. |
| `src/lib/actions/products.ts:646-672` | `updateProduct`: обновляет поля текущей карточки продукта напрямую. История значений не пишется. |
| `src/lib/actions/products.ts:674-710` | `uploadProductFile`/`deleteProductFile`: добавляет или удаляет файлы продукта. |
| `src/app/api/products/files/[id]/route.ts:4-24` | API для открытия файла продукта через signed URL. |
| `src/app/api/product-projects/files/[id]/route.ts:4-25` | API для открытия файла проекта изделия через signed URL. |

### 3.2 UI карточки и каталога продукта

| Место | Использование |
| --- | --- |
| `src/app/(protected)/products/page.tsx:1-15` | Страница каталога загружает `getProducts` и рендерит `ProductList`. |
| `src/app/(protected)/products/[id]/page.tsx:13-35` | Страница продукта загружает `getProduct`, показывает `ProductForm` и `ProductFileManager`. |
| `src/app/(protected)/products/new/page.tsx:10-23` | Страница создания продукта рендерит `ProductForm`. |
| `src/components/features/products/ProductList.tsx:14-80` | Таблица продуктов показывает названия, УКТЗЕД, чертеж, вес, цену, число файлов и статус. |
| `src/components/features/products/ProductForm.tsx:51-174` | Форма редактирует текущие поля продукта; на create опционально прикладывает PDF. |
| `src/components/features/products/ProductFileManager.tsx:24-135` | Загрузка/открытие/удаление файлов продукта; типы: drawing, step, pdf, photo, other. |
| `src/components/features/products/ProductOptionCombobox.tsx:27-41` | Поиск продукта в заказе строится по `name_uk`, `name_en`, `uktzed`, `drawing_number`, `characteristics`. |
| `src/components/features/products/ProductOptionCombobox.tsx:43-121` | Закрытое состояние показывает label `name_uk · uktzed · drawing_number`; список показывает `name_uk`, `uktzed`, `drawing_number`. |

Отдельной серверной пагинации/поиска каталога продуктов не найдено: `getProducts` возвращает список, отсортированный по `updated_at` (`src/lib/actions/products.ts:503-509`), а поиск для добавления в заказ выполняется на клиенте по уже переданному массиву (`src/components/features/machines/ProductOptionCombobox.tsx:55-58`).

### 3.3 Создание и редактирование заказа

| Место | Использование |
| --- | --- |
| `src/app/(protected)/sales-plan/new/page.tsx:20-40` | Страница нового заказа загружает `getProductOptions` и `getProductProjectSampleOptions`, затем передает их в `MachineCreateForm`. |
| `src/app/(protected)/sales-plan/actions.ts:185-190` | Для обычной товарной позиции `product_id` обязателен. |
| `src/app/(protected)/sales-plan/actions.ts:196-204` | Для образца обязательны `product_project_id` и `product_project_version_id`. |
| `src/app/(protected)/sales-plan/actions.ts:233-250` | Перед вставкой заказа активные продукты перечитываются из `products`; неактивный продукт добавить нельзя. |
| `src/app/(protected)/sales-plan/actions.ts:253-313` | Образец валидируется через `product_projects` и конкретный approved `product_project_versions.id`. |
| `src/app/(protected)/sales-plan/actions.ts:342-367` | Обычная товарная позиция вставляется с `product_id` и копией полей продукта: drawing/name/uktzed/characteristics/weight/price/coating. |
| `src/app/(protected)/sales-plan/actions.ts:369-395` | Позиция-образец вставляется без `product_id`, но с `product_project_id` и `product_project_version_id`, плюс копия полей версии проекта. |
| `src/app/(protected)/sales-plan/actions.ts:397-411` | При обновлении существующей product-backed строки обновляются количество, покрытие, RAL, sort order и иногда цена; product snapshot fields не перечитываются и не обновляются. |
| `src/app/(protected)/sales-plan/actions.ts:1002-1111` | `createMachine` создает `machine_items`, используя snapshot продукта или версии проекта. |
| `src/app/(protected)/sales-plan/actions.ts:1465-1501` | `updateMachine` загружает существующие ссылки product/project version и готовит maps для новых строк. |
| `src/app/(protected)/sales-plan/actions.ts:1503-1530` | Если существующая строка уже связана с продуктом/проектом, смена `product_id` или `product_project_id` запрещается. |
| `src/app/(protected)/sales-plan/actions.ts:1531-1588` | Legacy пустую строку можно заполнить продуктом или образцом; новая строка вставляется с snapshot payload. |
| `src/components/features/machines/MachineCreateForm.tsx:288-322` | UI копирует поля продукта/образца в поля строки формы при выборе. |
| `src/components/features/machines/MachineCreateForm.tsx:552-746` | В UI создания заказа поля чертежа, названия и веса для выбранного товара disabled; цена может браться из клиентской цены. |
| `src/components/features/machines/MachineEditDialog.tsx:397-430` | UI редактирования копирует поля продукта/образца аналогично create. |
| `src/components/features/machines/MachineEditDialog.tsx:762-934` | В UI редактирования существующий `product_id` заблокирован; для замены строку предлагается удалить и добавить новую. |

Итог по заказу: обычная позиция хранит и ссылку `product_id`, и снимок текущих полей продукта. Позиция-образец уже хранит ссылку на конкретную `product_project_version_id`. Версии каталожного продукта для обычных товаров сейчас нет.

### 3.4 Просмотр заказа и табы

- Список заказов выбирает `machine_items` с `product_id`, project refs и snapshot fields; summary product берется из первой не-sample строки `product_name` (`src/app/(protected)/sales-plan/actions.ts:840-906`).
- Детальная страница заказа выбирает snapshot fields и считает totals из `machine_items.weight`, `price`, `quantity` (`src/app/(protected)/sales-plan/actions.ts:921-995`).
- Таб `ItemsTab` разделяет goods/samples по `is_sample`, показывает чертеж, товар, вес, цену, количество, покрытие, и проверяет запуск раскроя по `product_id`, статусу продукта и файлам (`src/components/features/machines/tabs/ItemsTab.tsx:38-90`, `src/components/features/machines/tabs/ItemsTab.tsx:243-290`).

### 3.5 Генерация документов

Генерируются:

- Specification PDF.
- Invoice PDF.
- Packing List PDF.
- Quality Control PDF.
- ZIP со всеми документами.

Факты:

- Кнопки генерации перечисляют эти типы и вызывают `/api/documents/generate` (`src/components/features/documents/DocumentGenerationButtons.tsx:25-35`, `src/components/features/documents/DocumentGenerationButtons.tsx:80-119`).
- API использует `@react-pdf/renderer` `renderToBuffer` и `JSZip`; компоненты документов: `SpecificationDocument`, `InvoiceDocument`, `PackingListDocument`, `QualityControlDocument` (`src/app/api/documents/generate/route.ts:1-28`, `src/app/api/documents/generate/route.ts:41-93`).
- Данные документов загружаются из `machines`, `machine_items`, `machine_expenses`, `machine_packing_groups`, `clients`, `contracts`, `company_settings`; таблица `products` при генерации документов не читается (`src/lib/actions/document-generation.ts:241-382`).
- В document item попадают snapshot fields из `machine_items`: `product_name_en`, `product_name_uk`, `product_uktzed`, `quantity`, `price`, `weight`, `coating`, `ral_number`; `product_id`, STEP/PDF, `drawing_number` и версия продукта в DocumentItem отсутствуют (`src/lib/actions/document-generation.ts:50-100`, `src/lib/actions/document-generation.ts:361-380`).
- PDF-компоненты работают с `DocumentItem`, то есть с денормализованными полями строки заказа, а не с текущей карточкой продукта (`src/lib/pdf/SpecificationDocument.tsx`, `src/lib/pdf/InvoiceDocument.tsx`, `src/lib/pdf/PackingListDocument.tsx`, `src/lib/pdf/QualityControlDocument.tsx`).

### 3.6 Клиентские цены

- Таблица `client_product_prices` хранит цену по `client_id`, `product_id`, `coating`; unique constraint `(client_id, product_id, coating)` (`supabase/migrations/20260629100000_client_product_prices.sql:1-18`).
- Backfill цен строился из `machine_items.product_id`, `machine_items.coating`, `machine_items.price` (`supabase/migrations/20260629100000_client_product_prices.sql:55-92`).
- Server actions цен валидируют `productId` и `coating`, а order price lookup принимает список `productIds` (`src/lib/actions/client-product-prices.ts:19-29`, `src/lib/actions/client-product-prices.ts:75-105`).
- Серверная выборка цен получает только активные продукты из `products` и цены по `product_id` (`src/lib/client-prices/server.ts:59-99`, `src/lib/client-prices/server.ts:101-123`).

### 3.7 Раскрой / nesting / STEP+PDF

| Место | Использование |
| --- | --- |
| `src/lib/actions/machine-item-nesting.ts:78-94` | STEP определяется по `file_kind='step'` и `.step/.stp`; PDF-чертеж по `file_kind='pdf'/'drawing'` и `.pdf`/MIME. Требуется ровно один STEP и ровно один PDF. |
| `src/lib/actions/machine-item-nesting.ts:138-195` | Запуск раскроя для строки заказа требует `machine_items.product_id`; затем читает live `products` и все `product_files` по `product_id`. |
| `src/lib/actions/machine-item-nesting.ts:233-275` | Файлы передаются в nesting-service как `supabase://product-files/{file_path}`. |
| `src/lib/actions/machine-item-nesting.ts:281-343` | Состояние раскроя для строки пересчитывает количество STEP/PDF по текущим `product_files(product_id)`. |
| `src/lib/actions/machine-item-nesting.ts:396-460` | `startMachineItemNesting` сохраняет `machine_item_nesting_runs.product_id`, `step_file_id`, `drawing_file_id`, `nesting_project_id`. |
| `src/lib/actions/machine-item-nesting.ts:561-653` | Импорт результата раскроя создает `request_sheet_metal` с `source_product_id`, `source_machine_item_id`, `source_nesting_project_id`, `source_nesting_sheet_id`. |
| `supabase/migrations/104_machine_item_nesting_runs.sql:23-39` | Таблица `machine_item_nesting_runs` имеет FK на `products(id)` и `product_files(id)`, unique `(machine_item_id)`. |
| `supabase/migrations/104_machine_item_nesting_runs.sql:41-59` | `request_sheet_metal` хранит источники раскроя, включая `source_product_id`. |
| `supabase/migrations/109_nesting_batches.sql:13-24` | `nesting_batch_items` также хранит `product_id`, `step_file_id`, `drawing_file_id`. |
| `src/lib/actions/nesting-batches.ts:512-625` | Batch nesting читает `machine_items.product_id`, live `products`, live `product_files`; в payload передает `productId`, `productName`, `drawingNumber`, `stepStorageUri`, `pdfStorageUri`. |
| `src/lib/actions/nesting-future-fill.ts:303-360` | Future fill candidates также строятся по `machine_items.product_id`, live `products`, live `product_files` и требуют ровно один STEP/PDF. |
| `nesting-service/prisma/schema.prisma:64-88` | `ProjectInput` в nesting-service хранит `productId`, `productName`, `drawingNumber`, `stepStorageUri`, `pdfStorageUri`. |
| `nesting-service/prisma/schema.prisma:90-140` | `Part` хранит `sourceProductId`, `sourceMachineItemId`, геометрию и derived данные. |

### 3.8 Расстановка изделий / machine layout

- Расстановка строит snapshot текущих goods (`!is_sample`) и сохраняет `productId`, `productProjectId`, `productProjectVersionId`, `productName`, `drawingNumber`, `drawingFileSource`, `drawingFileId` (`src/lib/actions/machine-layout.ts:42-55`, `src/lib/actions/machine-layout.ts:170-193`).
- Для обычных продуктов `resolveDrawingFiles` берет файлы из `product_files` по `product_id`; для samples берет `product_project_files` по `version_id` (`src/lib/actions/machine-layout.ts:230-273`).
- Snapshot сравнивает `productId`, `productProjectVersionId`, `productName`, `drawingNumber`, `quantity`, `drawingFileId` (`src/lib/actions/machine-layout.ts:341-360`).
- PDF расстановки грузится в bucket `product-files` под `machine-layouts/{machineId}/...` и сохраняется в `machine_layout_requests` (`src/lib/actions/machine-layout.ts:749-826`).

### 3.9 Производство, склад, снабжение

- Производственный action при пропуске цинкования читает `machine_items(coating)`; карточку продукта не читает (`src/lib/actions/production.ts:245-257`).
- Gantt выбирает `machine_items(coating)` и использует покрытия для отображения/фильтров; product fields кроме coating не читаются (`src/app/(protected)/production/gantt/actions.ts:609-636`, `src/app/(protected)/production/gantt/actions.ts:807-815`).
- Снабженческие строки, созданные импортом раскроя, могут хранить `source_product_id` из `machine_item_nesting_runs.product_id` (`src/lib/actions/machine-item-nesting.ts:610-630`, `supabase/migrations/104_machine_item_nesting_runs.sql:41-50`).

### 3.10 Отчеты, экспорт, интеграции и cron

- PDF/ZIP документы описаны в разделе 3.5.
- DXF/ZIP экспорт существует в модуле nesting-service, но он работает по nesting project/sheet, а не напрямую по CRM `products` (`nesting-service/src/services/dxf.service.ts`, `src/app/api/nesting/dxf/[projectId]/route.ts`).
- Поиск по `1C|1С|интеграц|integration` не нашел интеграции с 1С или внешней учетной системой в `src`, `supabase/migrations`, `docs`, `nesting-service`.
- Поиск по `xlsx|excel|csv` не нашел Excel/CSV экспорта в CRM-зависимостях и исходниках; в `package.json` нет `xlsx`/`exceljs`/CSV-библиотеки (`package.json:16-40`).
- Есть cron-like endpoint `/api/tasks/due`, но он синхронизирует due transport-cost tasks и отправляет Telegram-доставку; продуктовые данные не читает (`src/app/api/tasks/due/route.ts:1-45`).
- Автоматические task triggers в БД создают задачи по машинам/материалам/датам; product-specific cron/фоновой задачи, читающей `products`, не найдено в проанализированных участках.

### 3.11 Денормализация и кэширование продуктовых данных

Данные продукта отдельно от `products` хранятся/фиксируются в следующих местах:

- `machine_items`: snapshot названия, УКТЗЕД, чертежа, характеристик, веса, цены и покрытия (`src/lib/types/database.ts:590-669`).
- `client_product_prices`: цена по `product_id + coating + client_id` (`supabase/migrations/20260629100000_client_product_prices.sql:1-18`).
- `machine_item_nesting_runs`: `product_id`, `step_file_id`, `drawing_file_id` (`supabase/migrations/104_machine_item_nesting_runs.sql:23-39`).
- `nesting_batch_items`: `product_id`, `step_file_id`, `drawing_file_id` (`supabase/migrations/109_nesting_batches.sql:13-24`).
- `request_sheet_metal`: `source_product_id`, `source_machine_item_id`, `source_nesting_project_id`, `source_nesting_sheet_id` после импорта раскроя (`supabase/migrations/104_machine_item_nesting_runs.sql:41-50`).
- `nesting-service` `ProjectInput`: `productId`, `productName`, `drawingNumber`, storage URIs (`nesting-service/prisma/schema.prisma:64-88`).
- `nesting-service` `Part`: `sourceProductId`, `sourceMachineItemId` (`nesting-service/prisma/schema.prisma:90-140`).
- `machine_layout_requests.item_snapshot`: snapshot item stores product/project/version/file ids as JSON (`src/lib/actions/machine-layout.ts:42-80`, `src/lib/actions/machine-layout.ts:170-193`).

## 4. Система задач и уведомлений

### 4.1 Tasks

- Базовая миграция создает enum `task_type` (`supply_start`, `technologist_request`, `engineer_confirm`) и enum `task_status` (`pending`, `in_progress`, `completed`, `cancelled`) (`supabase/migrations/27_procurement_requests_tasks.sql:19-30`).
- Базовая таблица `tasks`: `id`, `machine_id`, `assigned_to`, `task_type`, `title`, `description`, `status`, `start_date`, `deadline`, `completed_at`, `created_at`, `updated_at`; индексы по `machine_id`, `assigned_to`, `status`, `deadline` (`supabase/migrations/27_procurement_requests_tasks.sql:72-90`).
- Финальные generated types показывают, что `tasks` сейчас также имеет nullable `machine_id`, `related_meeting_id`, `product_project_id`, `consumable_request_id`, `supply_order_schedule_id`, `notified_at`, `telegram_error` (`src/lib/types/database.ts:3183-3244`).
- Product-project workflow добавляет task types `product_project_engineering` и `product_project_sales_review`, а также колонку `tasks.product_project_id` с индексом и partial index по активным задачам (`supabase/migrations/20260622130000_product_project_workflow.sql:1-2`, `supabase/migrations/20260622130000_product_project_workflow.sql:39-47`).
- `getTasks` читает tasks вместе с `machine`, `product_project`, `assigned_user` и фильтрует по `machine_id`, `product_project_id`, `assigned_to`, `status`, `task_type` (`src/lib/actions/tasks.ts:550-580`).
- `getMyTasks` показывает активные задачи текущего пользователя (`pending`, `in_progress`) (`src/lib/actions/tasks.ts:582-605`).
- Страница `/tasks` загружает active/completed tasks assigned текущему пользователю и delegation overview (`src/app/(protected)/tasks/page.tsx:11-60`).
- UI `MyTasksView` делит задачи на "На принятие", "Активные", "Завершенные", "Все" и считает просроченные (`src/components/features/tasks/MyTasksView.tsx:29-80`, `src/components/features/tasks/MyTasksView.tsx:81-160`).
- Завершение `product_project_engineering` валидирует deliverables, переводит версию/проект и создает менеджеру задачу `product_project_sales_review`; завершение sales review требует approved проект (`src/lib/actions/tasks.ts:463-514`, `src/lib/actions/tasks.ts:1139-1189`).
- Для новой будущей логики "добавили версию без крепления/комплектации -> задача менеджеру" текущая tasks-модель имеет `product_project_id`, но не имеет `product_id` или `product_version_id` (`src/lib/types/database.ts:3183-3244`).

### 4.2 Notifications

- Таблица `notifications`: `id`, `user_id`, `type`, `title`, `message`, `is_read`, `related_machine_id`, `created_at`; есть индексы по `user_id` и `related_machine_id` (`supabase/migrations/07_notifications.sql:1-19`).
- Generated types также показывают `consumable_request_id`, `telegram_notified_at`, `telegram_error`; product/product-version ссылок нет (`src/lib/types/database.ts:2297-2337`).
- `notify_users_by_role` создает notifications для всех активных пользователей заданной роли (`supabase/migrations/40_notifications_role_rpc.sql:1-23`).
- `getNotifications` читает уведомления текущего пользователя, присоединяя `machine` и `consumable_request`, фильтрует unread/limit/factory scope; `markAsRead`, `markAllAsRead` обновляют `is_read` (`src/app/(protected)/notifications/actions.ts:6-62`, `src/app/(protected)/notifications/actions.ts:64-108`).
- `NotificationBell` показывает счетчик unread, читает последние уведомления, подписывается на realtime `postgres_changes` по таблице notifications (`src/components/layout/NotificationBell.tsx:40-130`).
- `NotificationList` отображает страницу уведомлений, подписывается на realtime изменения и при клике ведет к заказу или заявке расходников (`src/components/features/notifications/NotificationList.tsx:33-105`).
- Telegram-доставка читает pending notifications и pending tasks, отправляет сообщения пользователям с `telegram_chat_id`, отмечает `telegram_notified_at`/`notified_at` или `telegram_error` (`src/lib/services/task-notifications.ts:83-149`, `src/lib/services/task-notifications.ts:151-214`).

## 5. Роли и права

- Роли хранятся в enum `user_role`: `financial_director`, `commercial_director`, `planning_director`, `sales_manager`, `engineer`, `technologist`, `supply_manager`, `production_manager` (`supabase/migrations/02_users.sql:1-12`).
- Таблица `users`: `id`, `email`, `full_name`, `role`, `factory_id`, `is_active`, `created_at`, `created_by`; индексы по `factory_id` и `email` (`supabase/migrations/02_users.sql:14-29`).
- Текущий пользователь определяется через Supabase auth user id, затем профиль читается из `users` вместе с `role`, `factory_id`, `is_active`; неактивный пользователь блокируется (`src/lib/auth/current-user.ts:41-93`).
- Ресурсы доступа включают `products`, `product_projects`, `client_prices`, `tasks`, `nesting`, `notifications` и другие (`src/lib/permissions/resources.ts:6-45`).
- `PRODUCT_ROLES` = `sales_manager`, `engineer`, directors; для ресурсов `products` и `product_projects` эти роли имеют view/manage по умолчанию (`src/lib/permissions/resources.ts:122-132`, `src/lib/permissions/resources.ts:188-212`).
- Таблица `role_permissions` хранит `role`, `resource_key`, `can_view`, `can_manage`, `updated_by`, `updated_at`; primary key `(role, resource_key)` (`supabase/migrations/20260601000000_role_permissions.sql:1-12`).
- Seed `role_permissions` дает `products` и `product_projects` ролям `financial_director`, `commercial_director`, `planning_director`, `sales_manager`, `engineer` (`supabase/migrations/20260601000000_role_permissions.sql:77-89`).
- `getCurrentUserPermissions` сначала учитывает membership/department permissions и позицию `Администратор CRM`, затем fallback на role permissions (`src/lib/permissions/server.ts:187-268`).
- `requirePermission(resourceKey, operation)` выбрасывает `Недостаточно прав`, если permission map не содержит нужного доступа (`src/lib/permissions/server.ts:282-295`).
- Product server actions используют `requirePermission('products'|'product_projects', 'view'|'manage')` через helper `requireProductAccess`/`requireProductManageAccess` (`src/lib/actions/products.ts:117-125`).

## 6. Загрузка файлов

### 6.1 `product-files`

- Bucket `product-files`: private, 50 МБ лимит (`supabase/migrations/103_product_catalog_and_projects.sql:111-113`).
- RLS/storage policies разрешают authenticated read и upload/update/delete для ролей `planning_director`, `financial_director`, `commercial_director`, `sales_manager`, `engineer` (`supabase/migrations/103_product_catalog_and_projects.sql:177-194`).
- Общий helper `uploadStorageFile` проверяет, что файл выбран и size > 0, строит путь `${prefix}/${Date.now()}-${randomUUID()}${ext}`, затем загружает в `product-files` (`src/lib/actions/products.ts:204-228`).
- Для `createProductWithFiles` расширения STEP/PDF проверяются (`src/lib/actions/products.ts:574-578`).
- Для `uploadProductFile` extension/mime по `file_kind` не проверяются; используются `file_kind` из формы и оригинальный файл (`src/lib/actions/products.ts:674-700`).
- Product/project file routes создают signed URL на 60 секунд (`src/app/api/products/files/[id]/route.ts:19-24`, `src/app/api/product-projects/files/[id]/route.ts:19-25`).
- Bucket `product-files` также используется для клиентских подписей/печатей (`src/lib/actions/clients.ts:110-119`, `src/lib/actions/clients.ts:292-340`), company signature/stamp (`src/lib/actions/company-settings.ts:137-187`) и PDF расстановки (`src/lib/actions/machine-layout.ts:749-826`).

### 6.2 `nesting-files` и manual nesting upload

- Bucket `nesting-files`: private, 500 МБ лимит (`supabase/migrations/20260618000000_nesting_storage.sql:1-6`).
- `nesting-service` env config имеет `MAX_FILE_SIZE_MB` default 500 и `NESTING_STORAGE_BUCKET` default `nesting-files` (`nesting-service/src/config.ts:16-40`).
- Fastify multipart ограничивает размер файла `MAX_FILE_SIZE_MB * 1024 * 1024` и до 200 файлов (`nesting-service/src/server.ts:31-37`).
- CRM upload endpoint `/api/nesting/upload` валидирует STEP `.step/.stp` до 500 МБ и PDF `.pdf` до 50 МБ; multipart upload доступен только local development, production ожидает storage URI (`src/app/api/nesting/upload/route.ts:7-44`, `src/app/api/nesting/upload/route.ts:56-107`).
- UI `NestingUploadForm` валидирует STEP до 500 МБ и PDF до 50 МБ, `accept=".step,.stp"` и `accept=".pdf"` (`src/components/features/nesting/NestingUploadForm.tsx:16-31`, `src/components/features/nesting/NestingUploadForm.tsx:214-233`).
- `nesting-service` materialize/validate проверяет allowed prefixes для `product-files` только `products/`, для `nesting-files` `uploads/` и `projects/`, а также сигнатуры STEP `ISO-10303-21` и PDF `%PDF` (`nesting-service/src/lib/storage.ts:11-15`, `nesting-service/src/lib/storage.ts:177-210`).
- Direct upload в nesting-service также проверяет расширения, размер и сигнатуры STEP/PDF (`nesting-service/src/services/upload.service.ts:31-69`, `nesting-service/src/services/upload.service.ts:138-149`).

## 7. Риски перехода от "1 продукт = 1 набор данных" к "1 продукт = N версий"

Факты ниже описывают места, которые сейчас завязаны на модель "один продукт имеет один текущий набор файлов/полей".

1. `product_files` привязаны к `product_id`, а не к версии. Nesting требует ровно один STEP и один PDF на продукт; несколько файлов для разных версий будут выглядеть как дубликаты и блокировать запуск раскроя (`src/lib/actions/machine-item-nesting.ts:78-94`, `src/lib/actions/machine-item-nesting.ts:168-183`).
2. Обычная строка заказа хранит `product_id` и snapshot полей, но не хранит `product_version_id`. Текущий hard reference на конкретную версию отсутствует (`src/lib/types/database.ts:590-669`, `src/app/(protected)/sales-plan/actions.ts:342-367`).
3. Образцы уже используют `product_project_version_id`, а обычные товары нет; это два разных режима привязки в одной таблице `machine_items` (`src/app/(protected)/sales-plan/actions.ts:369-395`, `src/app/(protected)/sales-plan/actions.ts:1503-1588`).
4. Редактирование продукта меняет текущую карточку `products` напрямую. Старые строки заказа сохраняют snapshot названия/веса/цены, но поздние процессы вроде nesting снова читают live `products`/`product_files` по `product_id` (`src/lib/actions/products.ts:646-672`, `src/lib/actions/machine-item-nesting.ts:138-195`).
5. `machine_item_nesting_runs`, `nesting_batch_items` и `request_sheet_metal.source_product_id` фиксируют `product_id` и file ids как источник раскроя; версии продукта там отсутствуют (`supabase/migrations/104_machine_item_nesting_runs.sql:23-50`, `supabase/migrations/109_nesting_batches.sql:13-24`).
6. В `nesting-service` входной проект хранит `productId`, `productName`, `drawingNumber`, `stepStorageUri`, `pdfStorageUri`, но не версию продукта; parts хранят `sourceProductId` (`nesting-service/prisma/schema.prisma:64-88`, `nesting-service/prisma/schema.prisma:90-140`).
7. Документы берут product fields из snapshot `machine_items`; они не знают о версии, change comment, STEP/PDF или креплении/комплектации (`src/lib/actions/document-generation.ts:50-100`, `src/lib/actions/document-generation.ts:361-380`).
8. Клиентские цены ключуются по `product_id + coating + client_id`; если разные версии одного продукта должны иметь разные цены, текущий ключ версии не различает (`supabase/migrations/20260629100000_client_product_prices.sql:1-18`, `src/lib/client-prices/server.ts:101-123`).
9. Machine layout snapshot хранит `productId` и `drawingFileId`, но для обычных продуктов не хранит version id; drawing file выбирается по `product_id` из общего набора product files (`src/lib/actions/machine-layout.ts:230-273`, `src/lib/actions/machine-layout.ts:341-360`).
10. Product catalog/search UI показывает продукт как одну запись с одним `drawing_number`, `unit_weight_kg`, `base_price_eur`, `status`; version label/change comment в модели выбора отсутствуют (`src/components/features/machines/ProductOptionCombobox.tsx:27-41`, `src/components/features/products/ProductList.tsx:14-80`).
11. Система задач имеет связь с `product_project_id`, но не с `product_id` или version id. Менеджерская задача по незаполненному креплению/комплектации версии продукта в текущей модели не имеет прямой FK-цели (`src/lib/types/database.ts:3183-3244`, `supabase/migrations/20260622130000_product_project_workflow.sql:39-47`).
12. Поля `крепление` и `тип комплектации` отсутствуют в `products`, `product_project_versions`, `product_files`, `machine_items` и tasks generated types; найденные упоминания "комплектация" относятся к складу/снабжению, не к продукту (`src/lib/types/database.ts:975-1203`, `src/lib/types/database.ts:590-669`, `src/lib/types/database.ts:3183-3244`).
13. Storage policies и file download API работают на уровне bucket/path/file row продукта; версионная область доступа или lifecycle в текущих product file routes не выражена (`supabase/migrations/103_product_catalog_and_projects.sql:177-194`, `src/app/api/products/files/[id]/route.ts:4-24`).
14. Промоутинг проекта изделия в продукт копирует ссылки на файлы из `product_project_files` в `product_files`, но не создает новую storage copy и не сохраняет дальнейшую историю версий каталожного продукта (`src/lib/actions/products.ts:1186-1251`).
15. Отчеты/история снабжения после импорта раскроя могут использовать `source_product_id` как окончательный продуктовый идентификатор; version-level provenance сейчас не хранится (`src/lib/actions/machine-item-nesting.ts:610-630`, `supabase/migrations/104_machine_item_nesting_runs.sql:41-59`).

## Статус работы

- ветка: `fix-hidden-bodies`
- HEAD SHA на момент анализа: `c5fa9ebdebd5f74c97a11821e8b4db007548a7d9`
- что в origin: отчёт не запушен; текущий checkout является предком `origin/main 597f645d2d9bccf9102ea91ec9cae434f1748f59`
- что в проде: не задеплоено
