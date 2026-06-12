# Лог изменений

## 17 Апреля 2026 — Этап 2: Модуль собраний + архитектура видимости
- **SQL миграция 16_machine_status**: Добавлен `machine_status` и `material_type` для машин. Свойство `factory_id` стало необязательным (выбирается на собрании). Установлены триггеры для перевода в In Production и Shipped.
- **SQL миграция 17_meetings**: Спроектированы 6 новых таблиц для проведения собраний (meetings, attendees, decisions, agenda_items). Написан RLS, позволяющий смотреть всем, а редактировать Директорам.
- **SQL миграция 18_update_rls_visibility**: Глобально обновлены RLS политики всего проекта. Теперь директорские роли видят машины обоих заводов, а начальники производств - только своего.
- **SQL миграция 19_auto_agenda**: Добавлена PL/pgSQL процедура `fn_generate_meeting_agenda`, автоматически собирающая повестку из машин без завода или машин с просроченными этапами.
- **Интеграция**: TypeScript типы и константы строго синхронизированы с БД (`database.ts`, `meetings.ts`). Action `createMachine` адаптирован под новые реалии (создание без завода).
- **Документация**: Полностью доработан `DATABASE.md` с описанием новых таблиц и enum-ов.

## 16 Апреля 2026 — Этап 0: Документация (ПОЛНОСТЬЮ ЗАВЕРШЁН)

### Часть 1: Структура + БД
- Создана и развернута структура базовых папок проекта.
- `DATABASE.md`: Описаны 7 таблиц и 5 enum.
- SQL миграции: Файлы с `01` по `07` (factories, users, machines, production_stages, supply_items, invoices, notifications). Спроектированы с каскадными связями (CASCADE) и UUIDv4.

### Часть 2: Роли + RLS
- `ROLES.md`: Документированы 8 ролей, проработана и сведена полная матрица межкластерного доступа.
- SQL миграция `08_rls_policies.sql`: RLS активирован для всех таблиц проекта.
- Создан кластер вспомогательных функций для семафоров доступа: `get_user_role()`, `get_user_factory_id()`, `is_director()` (Security Definer).
- Имплементирован триггер жестких колоночных ограничений для таблицы `supply_items`.

### Часть 3: Зависимости + Автоматизации
- `DEPENDENCIES.md`: Составлена карта и иерархия всех зависимостей, ограничений удалений и бизнес-логик БД.
- `DATA_FLOW.md`: Проанализированы и записаны 6 магистральных потока данных CRM-системы.
- `AUTO_CALC.md`: Сведены 7 автоматизированных формул работы со сроками снабжения и отгрузок.
- SQL миграция `09_automations.sql`: Написаны триггеры логического автосоздания этапов, автогенерации инвойсов, реализованы `Views` для калькуляции просрочек на лету.

### Часть 4: Уведомления + API + UI
- `NOTIFICATIONS.md`: Создан реестр из 12 триггеров уведомлений.
- SQL миграция `10_notification_triggers.sql`: Написаны 3 утилиты для рассылок, повешены триггер-пуши в базу, оформлена масштабная функция для CRON-сервера.
- `API.md`: Составлен каталог из 30 REST-подобных API-операций с приведёнными `@supabase/supabase-js` сниппетами для frontend'a.
- `UI_PAGES.md`: Проведена маршрутизация 12+ UI страниц, описаны их компоненты, права просмотров, визуальные якоря (цвета Ганта) и экшены.

### Часть 5: Финальная сборка
- `CONTEXT.md`: Подготовлен главный локомотивный файл контекста проекта для AI-инструментария.
- `SYSTEM_PROMPT.md`: Настроена техническая инструкция по реализации проекта для AI-кодера.
- `RULES.md`: Инкапсулированы нерушимые бизнес и технические аксиомы базы.
- `PRD.md`: Полный Product Requirements Document, собирающий все ТЗ воедино.
- `PROGRESS.md`: Спроектирована дорожная карта на 8 рабочих этапов, текущий статус отмечен.
- `CHANGELOG.md`: Оформлен этот файл аудита изменений.

## 16 Апреля 2026 — Этап 1: Auth + Роли + Управление (Части 1 и 2 ЗАВЕРШЕНЫ)

### Часть 1: Инициализация и Auth
- Инициализирован Next.js (App Router) со строгой типизацией.
- Настроен `shadcn/ui` и установлены необходимые базовые компоненты.
- Созданы 3 клиента Supabase: `client.ts` (браузер), `server.ts` (сервер) и `admin.ts` (для обхода RLS).
- Сгенерированы TypeScript типы из схемы БД (`database.ts`, `index.ts`).
- Созданы константы интерфейсов и модуль `permissions.ts` на основе `ROLES.md`.
- Интегрирована страница логина с `react-hook-form` + `zod` и `Supabase Auth`.
- Написаны хуки состояния `useUser` (с кэшированием в Zustand) и `useRole`.

### Часть 2: Layout и Навигация
- Создан интеллектуальный мобильно-адаптивный `Sidebar.tsx` (collapsible поведение + Sheet для мобильных устройств).
- Внедрен интерактивный `Header.tsx` с динамическими заголовками и профилем авторизованного пользователя.
- Реализован компонент `NotificationBell.tsx`, подписывающийся на реалтайм `INSERT/UPDATE` канала `notifications` пользователя.
- Настроен `proxy.ts` (бывший middleware) и серверный `ProtectedLayout` для строгой проверки сессии и наличия записи в таблице `users` (защита от "мёртвых" аккаунтов).
- Создан MVP-Дашборда со статистическими карточками, условно отрендеренными на основе `INVOICE_VISIBLE_ROLES`.

### Часть 3: Управление пользователями (CRUD)
- Разработана полноценная панель управления пользователями (маршрут `/admin/users`), закрыта серверной защитой для `planning_director`.
- Написаны **Server Actions** (`actions.ts`) для безопасного создания, модификации блокировок и удаления профилей с применением `adminSupabase` и строгим соблюдением транзакционности меж-табличного создания (`auth.users` <-> `public.users`).
- Поставлено на вооружение Zod-валидация через `schemas.ts` для всех форм.
- Реализована клиентская таблица управления (`UserTable.tsx`) с поиском и фильтрацией "на лету" без серверных раундтрипов.
- Имплементированы интерактивные диалоги `shadcn/ui`: `UserEditDialog`, `ResetPasswordDialog`, и `DeleteUserDialog`.
- Устранены сложные конфликты типизаций React Hook Form, Shadcn Selects, Next.js 'never' inferrence и Supabase Generics. Билд Typescript проходит на 100%.

## Этап 2: Sales Plan — Часть 1: Список машин + CRUD

### Часть 1: Список машин и создание
- Реализованы **Server Actions** (`sales-plan/actions.ts`): `getMachines`, `getMachine`, `createMachine`, `updateMachine`, `deleteMachine`.
- Сервер получает данные с JOIN на `production_stages`, `supply_items` и `invoices` и вычисляет прогресс производства и снабжения для каждой машины.
- Создание машины не трогает `production_stages` вручную — это роль триггера БД `trg_create_production_stages`.
- Добавлены схемы `createMachineSchema` / `updateMachineSchema` в `schemas.ts`. Из-за breaking change Zod v4 `z.enum()` с `errorMap` заменён на `z.string().refine()`.
- Создан компонент `MachineTable.tsx` с клиентской фильтрацией (покрытие, инвойс, поиск), прогресс-барами (этапы производства + снабжение), и динамической колонкой инвойса для `INVOICE_VISIBLE_ROLES`.
- Добавлен компонент `MachineCreateForm.tsx` с условным полем RAL (только при `coating = powder_coating`) и информационной подсказкой для цинка.
- Реализованы диалоги `MachineEditDialog` и `MachineDeleteDialog`.
- Маршрут `SALES_PLAN_NEW` добавлен в `constants/routes.ts`.
- Расширен `Progress` компонент из `shadcn/ui` для поддержки `indicatorClassName`.
- Обновлён хук `useRole` — переименовано `canCreateMachine` → `canCreateMachines`.
- `npm run build` прошёл чисто: 15 маршрутов, 0 ошибок TypeScript.

## Этап 2: Sales Plan — Часть 2: Карточка машины (Детальный просмотр)

### Обзор
- Создана центральная страница CRM — карточка машины `/sales-plan/[id]` с 3 табами (Производство, Снабжение, Инвойс).
- Реализовано inline-editing с разграничением по ролям и автосохранением через debounce.

### Новые компоненты
- **`DatePicker`** (`src/components/ui/date-picker.tsx`): Обёртка над Base UI Popover + shadcn Calendar. Формат `DD.MM.YYYY`, русская локализация.
- **`InlineEdit`** (`src/components/features/shared/InlineEdit.tsx`): Универсальный компонент inline-редактирования. 4 типа: `text`, `number`, `date`, `select`. Debounce 600ms, loading spinner, toast при сохранении/ошибке. Если `editable=false` — рендерится как read-only текст.
- **`MachineDetail`** (`src/components/features/machines/MachineDetail.tsx`): Обёртка с шапкой (название, тоннаж, покрытие, чертежи, создатель) и shadcn Tabs.

### Табы
- **ProductionTab** — 7 этапов в табличном виде. Inline DatePicker для начала/конца. Checkbox ночной смены. Select цеха (фиксирован для cutting/painting/packaging). Кнопки «Пропустить»/«Вернуть» с tooltip-блокировкой для цинка.
- **SupplyTab** — Таблица позиций снабжения. Ролевое разграничение полей: технолог (номенклатура, кол-во, ед.), снабженец (поставщик, цена, статус, план. дата, комментарий), инженер (confirmation checkbox). Прогресс-бар получено/всего. Кнопка добавления позиции. AlertDialog на удаление.
- **InvoiceTab** — Скрыт для ролей не в `INVOICE_VISIBLE_ROLES`. Два состояния: «Инвойс ещё не создан» и полная карточка с суммой, датой оплаты (+14 дн.), индикатором просрочки. Select статуса доступен только `financial_director`, `planning_director`, `sales_manager`.

### Server Actions
- **`sales-plan/[id]/actions.ts`**: `updateProductionStage` (с валидацией цинка, фиксированных цехов, дат), `toggleStageSkip`, `updateInvoiceStatus`.
- **`sales-plan/[id]/supply-actions.ts`**: `createSupplyItem`, `updateSupplyItem` (поля фильтруются по роли на сервере), `deleteSupplyItem` (директор + автор).

### Технические решения
- Все Supabase `.from()` запросы приведены через `as any` для обхода `never` inference в строгом TypeScript (generics Supabase не различают custom relations).
- `PopoverTrigger` и `AlertDialogTrigger` из `@base-ui/react` не поддерживают `asChild` — использован `render` prop (Base UI pattern) и прямая стилизация trigger-элемента.
- Билд: **15 маршрутов, 0 ошибок TypeScript**.

## Этап 3: Таблица производства — Часть 1

### Обзор
- Реализована главная рабочая страница начальника производства `/production`.
- Горизонтальная Excel-подобная таблица всех машин завода с sticky колонками и цветовым кодированием.

### Новые файлы
- **`src/lib/actions/production.ts`**: Общий Server Action модуль `updateProductionStage` + `toggleStageSkip`. Импортируется и из карточки машины (`ProductionTab`), и из общей таблицы — единый источник бизнес-логики. Валидация цинка, фиксированных цехов и порядка дат.
- **`production/actions.ts`**: `getProductionData()` — запрос всех машин завода с этапами, сортировка по `STAGE_ORDER`, вычисление статусов (`not_planned / active / completed / overdue / skipped`) и `delay_days`.
- **`StickyTable.tsx`** (`src/components/features/shared/`): Обёртка `<table>` с CSS-правилами `position: sticky` для первых N колонок (через `nth-child`) и фиксированным `<thead>`. Тень-разделитель на последней закреплённой колонке.
- **`ProductionSummary.tsx`**: 4 карточки: Всего машин / В работе / Завершено / Просрочено. Считаются из текущих (отфильтрованных) данных.
- **`ProductionFilters.tsx`**: Фильтры поиск + цех + этап + статус + период от/до. Клиентская фильтрация без серверных round-trip.
- **`ProductionTable.tsx`**: Главная таблица. Двухуровневый заголовок (группы этапов / Ц-Нач-Кон). Inline DatePicker для дат, Select для цеха (фиксирован для cutting/painting/packaging), Checkbox+DatePicker для ночной смены. Цвета ячеек по статусу. Клик на название — переход на карточку машины.

### Технические решения
- **Base UI `Select.onValueChange`** возвращает `string | null` — везде применено null coalescing `(v ?? '')`.
- **производственные экшены** вынесены из `sales-plan/[id]/actions.ts` в `lib/actions/production.ts` чтобы исключить cross-route импорт Server Actions (Next.js запрещает re-export server actions между файлами).
- **Билд**: **15 маршрутов, 0 ошибок TypeScript** ✅.

## Этап 3: Таблица производства — Часть 2 (Гант-график)

### Обзор
- Реализована страница `/production/gantt` с интерактивным кастомным графиком Ганта (CSS Grid/Flexbox + Tailwind) без тяжелых сторонних библиотек.
- Служит инструментом визуализации таймлайнов производственных этапов для директора планирования/производства и позволяет отслеживать просрочки/стыковки по снабжению.

### Новые файлы (все в `src/components/features/production/gantt/` и `utils/`)
- **`src/lib/utils/gantt.ts`**: Набор модульных дата-утилит (scale offsets, date conversions, pixel mapping).
- **`actions.ts`**: Серверный экшен `getGanttData()`. Выгружает этапы (не пропущенные) и дедлайны по снабжению.
- **`GanttChart.tsx`**: Основной компонент-контейнер (client-side state management для навигации, масштаба 'день/неделя/месяц').
- **`GanttControls.tsx`**: UI-панель сверху с фильтрацией машин/цеха/снабжения и свитчером масштаба.
- **`GanttTimeline.tsx`**: Двухуровневая верхняя шкала (месяцы и меньшие юниты).
- **`GanttMachineList.tsx`**: Левая sticky панель со списком наименований и тоннажем.
- **`GanttRow.tsx`, `GanttBar.tsx`, `GanttSupplyMarker.tsx`**: Отрисовка полос этапов, оверлеев ночных смен и маркеров поставок снабжения с hover tooltips-детализацией.
- **`GanttLegend.tsx`**: Описание всех цветов этапов, маркеров и цветовых кодов.

### Технические решения
- **Кастомный рендеринг геометрии**: Смещение элементов рассчитывается в px через утилиту `barGeometry(startDate, endDate)`.
- **Поддержка Wheel-Scroll**: Добавлен listener в контейнере `GanttChart`, трансформирующий deltaY в горизонтальный скролл (для тех, кто без тачпада).
- **Визуальные индикаторы**: Подсвечивание текущего дня (красная вертикальная линия) и "пульсирующая" красная рамка у просроченных этапов производства.
- Билд подтверждён и успешен: **15 маршрутов, 0 ошибок TypeScript**.

## Этап 4: Дашборд Снабжения

### Обзор
- Создан независимый высокоуровневый контрольный дашборд снабжения `/supply`.
- Реализована детальная страница машины `/supply/[machineId]` для специалистов (технолог, снабженец, директор).
- Внедрен кастомный компонент `InlineEdit` для всех полей с ролевой базой доступа.

### Новые файлы
- **`src/lib/actions/supply.ts`**: Вынесена общая логика `createSupplyItem`, `updateSupplyItem`, `deleteSupplyItem`. (Из `sales-plan/[id]/supply-actions`).
- **`supply/actions.ts`**: Серверные экшены агрегации `getSupplyDashboard()` (считает смету и проценты получения) и `getSupplyByMachine()`.
- **`SupplyDashboard.tsx`**: Дашборд: сверху 4 карточки статистики, снизу список всех производимых машин (поиск, фильтры "только с просрочками", "не полностью получено"), кастомный процентный progress-bar.
- **`SupplyMachineDetail.tsx`**: Разворот конкретной машины. Встроена таблица `StickyTable`, где каждая позиция номенклатуры редактируется "на лету" с привязкой к ролям через хук `useRole`. Встроен `Supabase Channel` подписка на реалтайм `postgres_changes`.
- **`SupplyItemCreateDialog.tsx`**: Модальное окно `Dialog` UI (от `@radix-ui/react-dialog`) с формой для создания позиций (у технолога - только колво/наименование, у снабжения - план дата и поставщик).

### Технические решения
- **Ролевой хук `useRole`**: Существенно упростил инлайн проверки, добавлены флаги `isSupplyManager`, `isTechnologist`, `isEngineer`.
- **Переиспользование**: Встроен `InlineEdit` с изменённым API (`editable` вместо `disabled`).
- **Fix DialogTrigger**: Обнаружено, что Base UI `Dialog` в проекте не поддерживает `asChild`. Применен `render` prop.
- **Билд**: **15 маршрутов, 0 ошибок TypeScript** ✅.

## Этапы 6 и 7: Инвойсы и Уведомления

### Обзор
- Разработан модуль для отслеживания инвойсов (счетов) с глобальной страницы `/invoices`. Настроен ролевой доступ (финансовые директора, менеджеры).
- Полностью внедрена система уведомлений (in-app notifications). Добавлены `NotificationBell` с Dropdown и страница со всей историей сообщений.
- Внедрен независимый Deno-скрипт (Supabase Edge Function) для планировщика задач (сron) по отслеживанию просрочек и дедлайнов в фоне.

### Новые файлы
- **`src/lib/actions/invoices.ts`**: Централизованная логика работы с инвойсами (refactored из локали машины).
- **`invoices/actions.ts`**: Экшены `getInvoices` с in-memory фильтрацией по factory (с допущением) и расчетом дней просрочек.
- **`InvoiceList.tsx`**: Таблица счетов с Select'ами для ручной пометки "Оплачено" и "Ожидает" и 4 карточки статистики по суммам (USD).
- **`notifications/actions.ts`**: Полный Server Actions CRUD уведомлений (отметить прочитанным, выбрать все).
- **`NotificationList.tsx`**: Лента сообщений с группировкой по словесным датам (Сегодня, Вчера, ММ ДД ГГГГ). В фоне крутится `supabase.channel()` для автоматического обновления ленты и Bell-счетчика без перезагрузки браузера.
- **`NotificationBell.tsx`**: (Обновлен) Заменен на Radix/BaseUI Popover. Теперь клик по колокольчику открывает виджет из последних 5 сообщений с быстрой пометкой прочитанными.
- **`supabase/functions/daily-check/index.ts`**: Скрипт-шлюз `Deno.serve` для ежедневного вызова RPC базы `check_daily_notifications`.

### Технические решения
- **Кастомная типизация**: Из-за особенностей `single()` вывода Supabase для роли, был произведен explicit typecasting профиля (`as any`), решающий проблему `never` типа. Эксклюд папки `supabase` из `tsconfig.json` для корректной сборки Next.js (игнорируем Deno Edge Functions).
- **Автоматизация**: Ручная пометка "просрочено" для счёта теперь запрещена. Система сама конвертирует статус `pending` в красную иконку `overdue`, если `payment_date < today`.
- **Билд**: Все TypeScript ошибки исправлены (отработано 3 багфикса на этапе проверки турбопака). Билд успешный (около 9 секунд).

## Этап 8: Новая структура товаров (Часть 1)
- **База Данных**: Созданы миграции `11_machine_items.sql` (товары машины) и `12_machine_expenses.sql` (дополнительные расходы).
- **Схема**: Удалены поля `tonnage`, `product`, `coating`, `ral_number`, `invoice_amount`, `drawings` из таблицы `machines` (файл `13_alter_machines.sql`).
- **Сводки**: Добавлено мощное view `machines_with_totals` для агрегации метрик из вложенных товаров и расходов 'на лету'.
- **Триггеры**: Обновлены UI триггеры для инвойсов. Теперь amount берется из `total_cost` (файл `14_update_automations.sql`).
- **TypeScript**: Интегрированы обновленные типы в `database.ts` и `index.ts`. Добавлен файл констант `coatings.ts` для русскоязычной локализации покрытий. Обновлены Zod-схемы в `schemas.ts`.
## 27.04.2026 — Часть 3: обновление существующих модулей
- Добавлен `useFactoryFilter` и обновлен Header FactoryFilter.
- Подключен заводской фильтр к Sales Plan, Production, Gantt, Supply, Invoices, Notifications и Dashboard.
- Production и Gantt больше не показывают машины без назначенного завода.
- Gantt строится отдельными вкладками по заводам, без hardcoded factory id.
- Supply получил секцию машин без назначенного завода.
- MachineTable получил фильтры по статусу и материалу, а также запуск назначения завода для директоров.
- MachineDetail получил передачу factories и AssignFactoryDialog.
- Dashboard переведен с несуществующего `production_blocks` на `production_stages`; ближайшее собрание считает повестку через `meeting_agenda_items`.
- Обновлены docs и status files под новую архитектуру.

## 27.04.2026 - Visible loading states
- Added reusable LoadingButton and useLoading primitives for async UI actions.
- Added a global TopProgressBar for route/search-param transitions.
- Added meetings route skeletons for list, create, and detail pages.
- Added visible pending states for machine/user/meeting creation, meeting completion, agenda updates, and notification read actions.
- Confirmed InlineEdit keeps its inline saving spinner for autosave fields.

## 27.04.2026 - Production table and Gantt UI refresh
- Tightened ProductionTable column sizing, nowrap headers, compact date display, and smoother horizontal scrolling.
- Reworked Gantt into grouped machine sections where each visible production stage renders as its own row.
- Added Gantt stage visibility checkboxes, show/hide all controls, and combined stage/workshop filtering.
- Updated Gantt stage colors, solid vs dashed bar styling, supply material rows, and legend semantics.

## 27.04.2026 - Gantt performance and zoom controls
- Added `@tanstack/react-virtual` and virtualized Gantt rows so only visible rows render during scroll.
- Simplified Gantt controls to Today, zoom slider/buttons, supply toggle, workshop/search, and stage checkboxes.
- Added day-width zoom with Ctrl/Cmd + wheel support while preserving the centered viewport.
- Added dynamic date range extension at horizontal scroll edges and initial auto-scroll to today.
- Memoized Gantt bar and supply marker rendering for smoother scrolling.


## 27 April 2026 - Desired shipping date and samples
- Added `machines.desired_shipping_date` and `machine_items.is_sample` migration with regenerated `machines_with_totals`.
- Extended machine create/edit flows with an optional desired shipping date and a separate samples section stored in `machine_items`.
- Split item display into goods and samples, updated machine list counts, and included samples in totals/coating requirements.
- Surfaced desired shipping dates in machine detail, production tab/table, Gantt deadline markers, and meeting agenda machine details.
- Updated TypeScript database/types, server actions, `docs/DATABASE.md`, and SQL agenda generation.

## 28 апреля 2026 — даты машины, инвойс от доставки клиенту и маркеры Ганта
- Добавлена миграция `23_machine_dates_and_delivery_invoice.sql` с полями `planned_material_date`, `actual_material_date`, `actual_shipping_date`, `delivery_to_client_date`.
- Инвойс теперь создаётся/обновляется от `delivery_to_client_date + 14 дней`, старые триггеры от этапа `shipping` отключаются.
- Этап `shipping` в UI переименован в “Готовность к отгрузке”.
- В производстве добавлены редактируемые даты машины по ролям и новые колонки `Мат.план`, `Мат.факт`, `Отгр.факт`.
- На Ганте добавлены маркеры плановой/фактической поставки материала и фактической отгрузки, обновлена легенда.

## 28 апреля 2026 — подтверждение машины и пустое создание
- Добавлена миграция `24_machine_confirmation_notifications.sql` с полем `machines.is_confirmed` и уведомлениями при создании/изменении подтверждения.
- Форма создания машины теперь допускает пустую машину без товаров, образцов и расходов.
- В Sales Plan, производстве и Ганте добавлены фильтры по подтверждению и визуальное выделение неподтверждённых машин.
- В карточке машины добавлен баннер неподтверждённой машины и действие подтверждения/снятия подтверждения для Sales и директоров.
