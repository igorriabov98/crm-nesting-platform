-- 08_rls_policies.sql
-- Настройка политик Row Level Security (RLS)

-- 1. Включение RLS на всех таблицах
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;


-- 2. Вспомогательные SQL функции (контекст сессии)

-- Получить роль текущего пользователя
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Получить factory_id текущего пользователя
CREATE OR REPLACE FUNCTION get_user_factory_id()
RETURNS uuid AS $$
  SELECT factory_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Проверить, является ли пользователь директором
CREATE OR REPLACE FUNCTION is_director()
RETURNS boolean AS $$
  SELECT role IN ('planning_director', 'financial_director', 'commercial_director')
  FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- 3. Политики безопасности (RLS)

-- ==========================================
-- factories
-- ==========================================
-- Все видят список заводов (readonly)
CREATE POLICY "Factories - Select all" 
  ON factories FOR SELECT 
  TO authenticated 
  USING (true);

-- ==========================================
-- users
-- ==========================================
-- Каждый видит юзеров только своего завода
CREATE POLICY "Users - Select factory" 
  ON users FOR SELECT 
  TO authenticated 
  USING (factory_id = get_user_factory_id());

-- CREATE, UPDATE, DELETE - только planning_director
CREATE POLICY "Users - Insert planning_director" 
  ON users FOR INSERT TO authenticated 
  WITH CHECK (get_user_role() = 'planning_director');

CREATE POLICY "Users - Update planning_director" 
  ON users FOR UPDATE TO authenticated 
  USING (get_user_role() = 'planning_director');

CREATE POLICY "Users - Delete planning_director" 
  ON users FOR DELETE TO authenticated 
  USING (get_user_role() = 'planning_director');

-- ==========================================
-- machines
-- ==========================================
-- SELECT: только своего завода
CREATE POLICY "Machines - Select factory" 
  ON machines FOR SELECT TO authenticated 
  USING (factory_id = get_user_factory_id());

-- INSERT: staff + sales
CREATE POLICY "Machines - Insert staff" 
  ON machines FOR INSERT TO authenticated 
  WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
  );

-- UPDATE: staff + sales
CREATE POLICY "Machines - Update staff" 
  ON machines FOR UPDATE TO authenticated 
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
  );

-- DELETE: только три директора
CREATE POLICY "Machines - Delete directors" 
  ON machines FOR DELETE TO authenticated 
  USING (is_director());

-- ==========================================
-- production_stages
-- ==========================================
-- SELECT: фильтрация через join (вложенный запрос) к machines
CREATE POLICY "Production Stages - Select factory" 
  ON production_stages FOR SELECT TO authenticated 
  USING (
    machine_id IN (SELECT id FROM machines WHERE factory_id = get_user_factory_id())
  );

-- INSERT/UPDATE: директора + production_manager
CREATE POLICY "Production Stages - Insert staff" 
  ON production_stages FOR INSERT TO authenticated 
  WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'production_manager')
  );

CREATE POLICY "Production Stages - Update staff" 
  ON production_stages FOR UPDATE TO authenticated 
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'production_manager')
  );

-- ==========================================
-- invoices
-- ==========================================
-- SELECT: директора + sales
CREATE POLICY "Invoices - Select role specific" 
  ON invoices FOR SELECT TO authenticated 
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
  );

-- UPDATE (status): коммерческий не может, sales и другие могут
CREATE POLICY "Invoices - Update status" 
  ON invoices FOR UPDATE TO authenticated 
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'sales_manager')
  );

-- (INSERT запрещён извне; выполняется только сервером (триггерами))

-- ==========================================
-- notifications
-- ==========================================
-- SELECT: только свои
CREATE POLICY "Notifications - Select own" 
  ON notifications FOR SELECT TO authenticated 
  USING (user_id = auth.uid());

-- UPDATE: помечать только свои (is_read)
CREATE POLICY "Notifications - Update own" 
  ON notifications FOR UPDATE TO authenticated 
  USING (user_id = auth.uid());

-- ==========================================
-- supply_items
-- ==========================================
-- SELECT: своего завода
CREATE POLICY "Supply Items - Select factory" 
  ON supply_items FOR SELECT TO authenticated 
  USING (
    machine_id IN (SELECT id FROM machines WHERE factory_id = get_user_factory_id())
  );

-- INSERT: разрешённые роли
CREATE POLICY "Supply Items - Insert staff" 
  ON supply_items FOR INSERT TO authenticated 
  WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'technologist', 'supply_manager')
  );

-- UPDATE: разрешаем всем вовлеченным, а детальную проверку колонок делегируем триггеру ниже
CREATE POLICY "Supply Items - Update staff" 
  ON supply_items FOR UPDATE TO authenticated 
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'engineer', 'technologist', 'supply_manager')
  );


-- 4. Колоночные ограничения UPDATE для supply_items (ПОДХОД "А")
-- В RLS PostgreSQL нет встроенной возможности проверять *какие именно* столбцы меняются.
-- Для честной проверки измененных колонок используется триггер.
CREATE OR REPLACE FUNCTION check_supply_items_column_update()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  
  -- Директора могут менять всё, проверка не требуется
  IF v_role IN ('planning_director', 'financial_director', 'commercial_director') THEN
    RETURN NEW;
  END IF;

  -- ИНЖЕНЕР может менять только engineer_confirmation
  IF v_role = 'engineer' THEN
    IF NEW.nomenclature IS DISTINCT FROM OLD.nomenclature OR
       NEW.unit IS DISTINCT FROM OLD.unit OR
       NEW.quantity IS DISTINCT FROM OLD.quantity OR
       NEW.supplier IS DISTINCT FROM OLD.supplier OR
       NEW.price_per_unit IS DISTINCT FROM OLD.price_per_unit OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.comment IS DISTINCT FROM OLD.comment OR
       NEW.planned_delivery_date IS DISTINCT FROM OLD.planned_delivery_date THEN
      RAISE EXCEPTION 'Инженер имеет право редактировать только поле подтверждения (engineer_confirmation).';
    END IF;
  END IF;

  -- ТЕХНОЛОГ может менять только номенклатуру (nomenclature, unit, quantity)
  IF v_role = 'technologist' THEN
    IF NEW.engineer_confirmation IS DISTINCT FROM OLD.engineer_confirmation OR
       NEW.supplier IS DISTINCT FROM OLD.supplier OR
       NEW.price_per_unit IS DISTINCT FROM OLD.price_per_unit OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.comment IS DISTINCT FROM OLD.comment OR
       NEW.planned_delivery_date IS DISTINCT FROM OLD.planned_delivery_date THEN
      RAISE EXCEPTION 'Технолог имеет право редактировать только номенклатуру, единицы измерения и количество.';
    END IF;
  END IF;

  -- СНАБЖЕНИЕ может менять поставщика, цены и статусы
  IF v_role = 'supply_manager' THEN
    IF NEW.engineer_confirmation IS DISTINCT FROM OLD.engineer_confirmation OR
       NEW.nomenclature IS DISTINCT FROM OLD.nomenclature OR
       NEW.unit IS DISTINCT FROM OLD.unit OR
       NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      RAISE EXCEPTION 'Снабжение не может редактировать номенклатуру инженера/технолога.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_supply_items_column_acl
BEFORE UPDATE ON supply_items
FOR EACH ROW
EXECUTE FUNCTION check_supply_items_column_update();
