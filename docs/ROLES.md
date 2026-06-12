# Роли, Политики (RLS) и Права доступа

В системе предусмотрено 8 различных ролей пользователей, обеспечивающих разные уровни доступа к данным в CRM.

## 1. Описание ролей

### Директора (Полный доступ)
1. **planning_director** — Директор планирования: единственная роль, имеющая права на управление пользователями (регистрация, изменение ролей, деактивация). Просмотр и редактирование других данных системы, включая инвойсы.
2. **financial_director** — Финансовый директор: полный доступ ко всем таблицам производства и снабжения. Имеет права на изменение статуса инвойсов.
3. **commercial_director** — Коммерческий директор: полный доступ к таблицам, возможность просматривать инвойсы (но без права редактирования их статуса).

### Линейный Персонал (Ограниченный доступ)
4. **sales_manager** — Sales менеджер: создаёт планы продаж (`machines`), может редактировать статусы оплаты (`invoices`).
5. **engineer** — Инженер: подтверждает правильность номенклатур (редактирует `engineer_confirmation`). Просматривает все производственные данные, инвойсы не видит.
6. **technologist** — Технолог: отвечает за чертежи и номенклатуру. Редактирует поля: `nomenclature`, `unit`, `quantity` в `supply_items`. Просматривает все производственные данные, инвойсы не видит.
7. **supply_manager** — Снабжение: работает с закупками. Редактирует поля: `supplier`, `price_per_unit`, `status`, `comment`, `planned_delivery_date` в `supply_items`. Инвойсы не видит.
8. **production_manager** — Начальник производства: отмечает статусы по производству. Обновляет все поля таблицы `production_stages`. Инвойсы не видит.

---

## 2. Матрица доступа (CRUD)

| Таблица / Действие | planning_director | financial_director | commercial_director | sales_manager | engineer | technologist | supply_manager | production_manager |
|--------------------|------|------|------|------|------|------|------|------|
| **users** CREATE | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **users** READ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **users** UPDATE | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **users** DELETE | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **machines** CREATE | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **machines** READ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **machines** UPDATE | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **machines** DELETE | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **production_stages** CREATE| ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **production_stages** READ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **production_stages** UPDATE | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **production_stages** DELETE | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **supply_items** CREATE | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **supply_items** READ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **supply_items** UPDATE (engineer) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **supply_items** UPDATE (technologist)| ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **supply_items** UPDATE (supply fields)| ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **supply_items** DELETE | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **invoices** READ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **invoices** UPDATE status | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **invoices** CREATE (triggers) | 🤖 | 🤖 | 🤖 | 🤖 | 🤖 | 🤖 | 🤖 | 🤖 |
| **notifications** READ (свои)| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **notifications** UPDATE (свои)| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*(Примечание: символ 🤖 означает, что операция выполняется авто-триггерами на уровне сервера PostgreSQL на основе других действий).*

---

## 3. RLS Политики (Row Level Security)

В Supabase безопасность реализуется на уровне строк (Row Level Security). Все таблицы защищены директивой `ENABLE ROW LEVEL SECURITY`. 

### `factories`
- **SELECT:** Все авторизованные пользователи могут читать список заводов (seed data).

### `users`
- **SELECT:** Пользователи могут видеть других пользователей (всего завода или всех в зависимости от политики, в данном случае — только пользователей **СВОЕГО завода** по совпадению `factory_id`).
- **INSERT/UPDATE/DELETE:** Управлять пользователями может **только `planning_director`**.

### `machines`
- **SELECT:** Пользователь видит только машины своего завода (через фильтр `get_user_factory_id()`).
- **INSERT/UPDATE/DELETE:** Разрешено определенным ролям согласно матрице.

### `production_stages`
- **SELECT:** Встроенный JOIN-запрос к `machines` гарантирует, что пользователь видит только этапы своего завода (`machine_id IN (SELECT id FROM machines...)`).
- **INSERT/UPDATE:** Вставка и смена статусов доступны директорам и `production_manager`.

### `supply_items`
- **SELECT:** Просмотр позиций для машин своего завода.
- **Column-level Security (Триггер):** В PostgreSQL RLS `CREATE POLICY` не умеет напрямую проверять, какие именно колонки изменил пользователь, без сложного сравнения и указания. В данном решении применен подход с перехватом через **триггерную функцию `check_supply_items_column_update()`** (Подход "А"). 
  - Эта функция извлекает роль и проверяет, что каждый ограниченный пользователь (engineer, technologist, supply_manager) редактирует *только свои* разрешенные колонки, и выдает исключение (RAISE EXCEPTION), если затронуто чужое поле.

### `invoices`
- **SELECT:** Доступ к финансам имеют только `planning_director`, `financial_director`, `commercial_director` и `sales_manager`.
- **UPDATE:** Коммерческий директор видит инвойсы, но изменять статус может только `planning_director`, `financial_director` и `sales_manager`.
- **INSERT/DELETE:** Блокирован на уровне RLS. Создание инвойса выполняется сугубо серверными авто-триггерами `AFTER INSERT OR UPDATE`.

### `notifications`
- **SELECT / UPDATE:** Жесткая привязка по `user_id = auth.uid()`. Разрешен полный контроль только над собственными уведомлениями.

---

## 4. Примечания
- **Функции контекста:** Для работы политик созданы служебные RPC-функции `get_user_role()`, `get_user_factory_id()`, и `is_director()`.
- **Security Definer:** Функции контекста используют модификатор `SECURITY DEFINER` (выполняются от имени суперадмина). Это сделано для того, чтобы база данных могла внутри политики проверить роль текущего `auth.uid()` в таблице `users`, даже если обычный `SELECT` к таблице пользователей был бы ограничен. Это стандартная «обёртка» для доступа к Custom Roles в контуре Supabase.
## Обновление 27.04.2026: видимость заводов и meetings
- `production_manager`: видит только свой завод, не видит машины без завода, не видит глобальный FactoryFilter.
- Все остальные роли: могут видеть оба завода и машины без завода через глобальный FactoryFilter.
- Директора (`planning_director`, `financial_director`, `commercial_director`) могут назначать завод машине и управлять собраниями.
- `canSeeAllFactories(role)` возвращает `false` только для `production_manager`.
- `canAssignFactory(role)` и `canManageMeetings(role)` доступны только директорским ролям.
- Машины без завода отображаются в Sales Plan, Supply и Dashboard, но исключаются из Production и Gantt.
