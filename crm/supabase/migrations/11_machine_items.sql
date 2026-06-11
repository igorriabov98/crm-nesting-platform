/* Товары машины (1 чертёж = 1 товар) */
CREATE TABLE machine_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  drawing_number text NOT NULL,            /* Номер чертежа */
  product_name text NOT NULL,              /* Название товара */
  weight decimal NOT NULL CHECK (weight > 0),  /* Вес единицы (тонны) */
  price decimal NOT NULL CHECK (price >= 0),   /* Цена за единицу */
  quantity integer NOT NULL CHECK (quantity > 0), /* Количество */
  coating coating_type NOT NULL DEFAULT 'none', /* Покрытие */
  ral_number text,                         /* RAL (если порошковая) */
  sort_order integer NOT NULL DEFAULT 0,   /* Порядок сортировки */
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

/* Индексы */
CREATE INDEX idx_machine_items_machine_id ON machine_items(machine_id);

/* RLS */
ALTER TABLE machine_items ENABLE ROW LEVEL SECURITY;

/* Политики: аналогично machines */
/* SELECT: все аутентифицированные (через JOIN на machines.factory_id) */
/* INSERT/UPDATE: директора + sales_manager */
/* DELETE: директора + sales_manager */

CREATE POLICY "machine_items_select" ON machine_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_items.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_items_insert" ON machine_items
  FOR INSERT WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_items.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_items_update" ON machine_items
  FOR UPDATE USING (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_items.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_items_delete" ON machine_items
  FOR DELETE USING (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_items.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );
