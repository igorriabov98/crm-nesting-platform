# REST API & Данные (Supabase)

Этот документ описывает все операции с данными через Supabase Client (`@supabase/supabase-js`). Каждая операция сопровождается примером вызова, что служит шпаргалкой для разработки frontend-части. Управление безопасностью обеспечивается через RLS, поэтому запросы выполняются от лица залогиненного пользователя.

---

## 🔐 Auth

### 1. Регистрация пользователя
- **Роли:** `planning_director`
- **Комплекс:** В Supabase регистрация требует Admin API ключей для тихой регистрации в Auth. Контекст:
  Сначала Edge Function `supabase.auth.admin.createUser`, потом Insert:
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('users').insert({ id: authUserId, email, full_name, role, factory_id })
  ```

### 2. Логин
- **Роли:** Все
- **Метод:** Auth POST
- **Supabase вызов:**
  ```javascript
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  ```

### 3. Логаут
- **Роли:** Все
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.auth.signOut()
  ```

### 4. Получение текущего пользователя и его роли
- **Роли:** Все
- **Метод:** SELECT-Сборка сессии
- **Supabase вызов:**
  ```javascript
  const { data: user } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
  ```

---

## 👥 Users (Управление)

### 5. Получить список пользователей завода
- **Роли:** Директора
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  // RLS автоматически отфильтрует по factory_id
  const { data } = await supabase.from('users').select('*'); 
  ```

### 6. Создать пользователя (Добавить в таблицу)
- **Роли:** `planning_director`
- **Метод:** INSERT
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('users').insert({ email, full_name, role, factory_id })
  ```

### 7. Обновить пользователя
- **Роли:** `planning_director`
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('users').update({ role: 'engineer' }).eq('id', userId)
  ```

### 8. Деактивировать пользователя
- **Роли:** `planning_director`
- **Метод:** UPDATE (`is_active`)
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('users').update({ is_active: false }).eq('id', userId)
  ```

---

## 🏗 Machines (Sales Plan)

### 9. Получить список машин завода
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  // RLS сам возвращает только машины своего завода
  const { data } = await supabase.from('machines').select('*').order('created_at', { ascending: false });
  ```

### 10. Получить одну машину
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('machines').select('*, users (full_name)').eq('id', machineId).single();
  ```

### 11. Создать машину
- **Роли:** `sales_manager`, Директора
- **Метод:** INSERT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('machines').insert({ factory_id, name, tonnage, drawings, product, coating, ral_number, invoice_amount }).select().single();
  // Триггеры автоматически создадут production_stages.
  ```

### 12. Обновить машину
- **Роли:** `sales_manager`, Директора
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('machines').update({ tonnage: 50.5 }).eq('id', machineId);
  ```

### 13. Удалить машину
- **Роли:** Директора
- **Метод:** DELETE
- **Supabase вызов:**
  ```javascript
  // Все зависимые этапы/инвойсы удалятся механизмом CASCADE.
  const { error } = await supabase.from('machines').delete().eq('id', machineId);
  ```

---

## 🏭 Production Stages

### 14. Получить все этапы машины
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('production_stages').select('*').eq('machine_id', machineId).order('stage_type');
  ```

### 15. Обновить этап
- **Роли:** `production_manager`, Директора
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  const { error } = await supabase.from('production_stages').update({ 
    date_start: '2023-11-01', date_end: '2023-11-05', workshop: 1 
  }).eq('id', stageId);
  ```

### 16. Получить все этапы для Ганта (с задержками)
- **Метод:** SELECT FROM VIEW
- **Supabase вызов:**
  ```javascript
  // Работаем через view `production_stages_with_delay`
  const { data } = await supabase.from('production_stages_with_delay').select('*, machines(*)');
  ```

---

## 📦 Supply Items

### 17. Получить все позиции машины
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('supply_items').select('*').eq('machine_id', machineId);
  ```

### 18. Дашборд снабжения (Все машины)
- **Метод:** SELECT FROM VIEW
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('supply_items_with_overdue').select('*, machines (name, tonnage)');
  ```

### 19. Создать позицию снабжения
- **Роли:** `technologist`, `supply_manager`
- **Метод:** INSERT
- **Supabase вызов:**
  ```javascript
  await supabase.from('supply_items').insert({ machine_id, nomenclature: 'Деталь X', unit: 'pcs', quantity: 15 });
  ```

### 20. Обновить позицию (Инженер)
- **Роли:** `engineer`
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  // Триггер безопасности пропустит только это поле
  await supabase.from('supply_items').update({ engineer_confirmation: true }).eq('id', itemId);
  ```

### 21. Обновить позицию (Технолог)
- **Роли:** `technologist`
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  await supabase.from('supply_items').update({ nomenclature: 'NEW', quantity: 20 }).eq('id', itemId);
  ```

### 22. Обновить позицию (Снабжение)
- **Роли:** `supply_manager`
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  await supabase.from('supply_items').update({ supplier: 'Mega Corp', price_per_unit: 100, status: 'ordered', planned_delivery_date: '2023-12-01' }).eq('id', itemId);
  ```

---

## 💳 Invoices

### 23. Получить инвойс машины
- **Роли:** `sales_manager`, Директора
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('invoices').select('*').eq('machine_id', machineId).single();
  ```

### 24. Получить список инвойсов
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('invoices').select('*, machines (name)');
  ```

### 25. Обновить статус инвойса
- **Роли:** `sales_manager`, `financial_director`, `planning_director`
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId);
  ```

---

## 🔔 Notifications

### 26. Получить уведомления
- **Метод:** SELECT
- **Supabase вызов:**
  ```javascript
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  ```

### 27. Пометить как прочитанное
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
  ```

### 28. Пометить все как прочитанные
- **Метод:** UPDATE
- **Supabase вызов:**
  ```javascript
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id).eq('is_read', false);
  ```

### 29. Получить количество непрочитанных
- **Метод:** SELECT (Count)
- **Supabase вызов:**
  ```javascript
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('is_read', false);
  ```

---

## 📊 Гант График

### 30. Получить данные для Ганта (Сводка)
- **Композитный запрос:** Использование Promise.all для скачивания нужных данных UI.
- **Supabase вызов:**
  ```javascript
  const [stages, items] = await Promise.all([
    supabase.from('production_stages_with_delay').select('*, machines(name, coating)'),
    supabase.from('supply_items_with_overdue').select('*')
  ]);
  // На фронте объединяется массивом по id
  ```
