-- Technologist request completion, future detailing and metal scrap ledger.
-- All state-changing public functions are atomic and keep an immutable audit trail.

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'future_detailing_confirmation';
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'metal_scrap_review';

CREATE TABLE public.technologist_request_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.technologist_requests(id) ON DELETE RESTRICT,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  future_detailing_decision text NOT NULL CHECK (future_detailing_decision IN ('has_items','none')),
  entered_plasma_minutes integer NOT NULL CHECK (entered_plasma_minutes >= 0),
  added_plasma_minutes integer NOT NULL CHECK (added_plasma_minutes >= 0),
  actual_plasma_minutes integer NOT NULL CHECK (actual_plasma_minutes = entered_plasma_minutes + added_plasma_minutes),
  state text NOT NULL DEFAULT 'finalized' CHECK (state IN ('draft','finalized')),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.technologist_request_waste_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid NOT NULL REFERENCES public.technologist_request_completions(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE RESTRICT,
  source_table text NOT NULL CHECK (source_table IN ('request_sheet_metal','request_pipe','request_circle','request_knives')),
  source_id uuid NOT NULL,
  item_name text NOT NULL,
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  material_variant_id uuid REFERENCES public.material_variants(id) ON DELETE SET NULL,
  material_name text NOT NULL,
  material_grade text,
  weight_snapshot_kg numeric(14,3) NOT NULL CHECK (weight_snapshot_kg > 0),
  waste_percent numeric(4,1) NOT NULL CHECK (waste_percent BETWEEN 0 AND 100),
  scrap_weight_kg numeric(14,3) NOT NULL CHECK (scrap_weight_kg >= 0),
  useful_weight_kg numeric(14,3) NOT NULL CHECK (useful_weight_kg >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, source_table, source_id)
);

CREATE TABLE public.future_detailing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.technologist_requests(id) ON DELETE RESTRICT,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','awaiting_confirmation','confirmed','cancelled')),
  confirmation_due_date date,
  confirmation_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  first_cutting_event_id uuid REFERENCES public.production_fact_cutting_events(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.future_detailing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.future_detailing_batches(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  planned_quantity integer NOT NULL CHECK (planned_quantity > 0),
  actual_quantity integer CHECK (actual_quantity >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','awaiting_confirmation','confirmed','cancelled')),
  variance_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, part_id)
);

CREATE TABLE public.technologist_completion_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE RESTRICT,
  change_type text NOT NULL CHECK (change_type IN ('future_detailing','waste','plasma_time','future_detailing_confirmation','scrap_review')),
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.metal_scrap_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE RESTRICT,
  waste_item_id uuid NOT NULL UNIQUE REFERENCES public.technologist_request_waste_items(id) ON DELETE RESTRICT,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  material_variant_id uuid REFERENCES public.material_variants(id) ON DELETE SET NULL,
  material_name text NOT NULL,
  material_grade text,
  expected_weight_kg numeric(14,3) NOT NULL CHECK (expected_weight_kg >= 0),
  available_weight_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (available_weight_kg >= 0),
  blocked_weight_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (blocked_weight_kg >= 0),
  sold_weight_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (sold_weight_kg >= 0),
  status text NOT NULL DEFAULT 'future' CHECK (status IN ('future','available','review_required')),
  promoted_stage_end date,
  review_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_weight_kg + blocked_weight_kg + sold_weight_kg <= expected_weight_kg + 0.001)
);

CREATE TABLE public.metal_scrap_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  sale_date date NOT NULL,
  total_weight_kg numeric(14,3) NOT NULL CHECK (total_weight_kg > 0),
  amount_uah numeric(14,2) NOT NULL CHECK (amount_uah >= 0),
  average_price_per_kg numeric(14,4) GENERATED ALWAYS AS (amount_uah / NULLIF(total_weight_kg, 0)) STORED,
  buyer text,
  document_number text,
  comment text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.metal_scrap_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.metal_scrap_sales(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.metal_scrap_lots(id) ON DELETE RESTRICT,
  weight_kg numeric(14,3) NOT NULL CHECK (weight_kg > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sale_id, lot_id)
);

CREATE TABLE public.metal_scrap_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.metal_scrap_lots(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.metal_scrap_sales(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('planned','available','correction','blocked','reviewed','sale','sale_cancelled')),
  weight_delta_kg numeric(14,3) NOT NULL,
  available_after_kg numeric(14,3) NOT NULL,
  blocked_after_kg numeric(14,3) NOT NULL,
  sold_after_kg numeric(14,3) NOT NULL,
  reason text,
  performed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.metal_scrap_finance_incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL UNIQUE REFERENCES public.metal_scrap_sales(id) ON DELETE RESTRICT,
  amount_uah numeric(14,2) NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX future_detailing_batches_queue_idx ON public.future_detailing_batches(factory_id, status, confirmation_due_date);
CREATE INDEX future_detailing_batches_owner_idx ON public.future_detailing_batches(created_by, status, confirmation_due_date);
CREATE INDEX metal_scrap_lots_queue_idx ON public.metal_scrap_lots(factory_id, status, material_id, material_variant_id);
CREATE INDEX metal_scrap_lots_request_idx ON public.metal_scrap_lots(request_id, created_at);
CREATE INDEX metal_scrap_sales_factory_date_idx ON public.metal_scrap_sales(factory_id, sale_date DESC);
CREATE INDEX completion_changes_request_idx ON public.technologist_completion_changes(request_id, created_at DESC);
CREATE INDEX detailing_parts_name_search_idx ON public.detailing_parts(lower(name) text_pattern_ops) WHERE is_active;

CREATE OR REPLACE FUNCTION public.next_weekday(p_date date) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE extract(isodow FROM p_date)
    WHEN 5 THEN p_date + 3
    WHEN 6 THEN p_date + 2
    ELSE p_date + 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finalize_technologist_request(
  p_request_id uuid, p_actor uuid, p_decision text, p_entered_plasma_minutes integer,
  p_waste_items jsonb, p_future_items jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request technologist_requests%ROWTYPE; v_machine machines%ROWTYPE; v_completion uuid; v_batch uuid;
  v_item jsonb; v_weight numeric; v_pct numeric; v_part uuid; v_lot uuid; v_now timestamptz := now(); v_detailing_check jsonb;
BEGIN
  IF p_actor IS NULL OR p_actor <> auth.uid() THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  IF p_decision NOT IN ('has_items','none') OR p_entered_plasma_minutes < 0 THEN RAISE EXCEPTION 'Некорректные данные завершения'; END IF;
  SELECT * INTO v_request FROM technologist_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.created_by <> p_actor THEN RAISE EXCEPTION 'Заявка недоступна'; END IF;
  IF v_request.status NOT IN ('pending_stock_check','stock_checked') THEN RAISE EXCEPTION 'Заявка уже завершена'; END IF;
  SELECT * INTO v_machine FROM machines WHERE id=v_request.machine_id;
  IF v_machine.factory_id IS NULL THEN RAISE EXCEPTION 'У машины не указан завод'; END IF;
  v_detailing_check:=public.fn_validate_detailing_request_check(p_request_id,p_actor);
  IF coalesce((v_detailing_check->>'ready')::boolean,false)=false THEN RAISE EXCEPTION '%',coalesce(v_detailing_check->>'message','Проверьте бронь деталировки'); END IF;
  IF EXISTS (SELECT 1 FROM technologist_request_completions WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'Заявка уже зафиксирована'; END IF;
  IF jsonb_array_length(COALESCE(p_waste_items,'[]')) = 0 THEN RAISE EXCEPTION 'Укажите отходность металлических позиций'; END IF;
  IF p_decision='has_items' AND jsonb_array_length(COALESCE(p_future_items,'[]'))=0 THEN RAISE EXCEPTION 'Добавьте будущую деталировку'; END IF;
  IF p_decision='none' AND jsonb_array_length(COALESCE(p_future_items,'[]'))>0 THEN RAISE EXCEPTION 'Решение не соответствует деталировке'; END IF;

  INSERT INTO technologist_request_completions(request_id,machine_id,factory_id,created_by,future_detailing_decision,entered_plasma_minutes,added_plasma_minutes,actual_plasma_minutes)
  VALUES(p_request_id,v_request.machine_id,v_machine.factory_id,p_actor,p_decision,p_entered_plasma_minutes,ceil(p_entered_plasma_minutes*0.25),p_entered_plasma_minutes+ceil(p_entered_plasma_minutes*0.25)) RETURNING id INTO v_completion;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_waste_items) LOOP
    IF v_item->>'sourceTable' NOT IN ('request_sheet_metal','request_pipe','request_circle','request_knives') THEN RAISE EXCEPTION 'Некорректный тип позиции'; END IF;
    EXECUTE format('SELECT calculated_weight_kg FROM public.%I WHERE id=$1 AND request_id=$2',v_item->>'sourceTable') INTO v_weight USING (v_item->>'sourceId')::uuid,p_request_id;
    IF v_weight IS NULL OR v_weight <= 0 THEN RAISE EXCEPTION 'Не рассчитан вес позиции: %',coalesce(v_item->>'itemName',v_item->>'sourceId'); END IF;
    v_pct := (v_item->>'wastePercent')::numeric;
    IF v_pct < 0 OR v_pct > 100 OR v_pct <> round(v_pct,1) THEN RAISE EXCEPTION 'Отходность должна быть 0–100%% с точностью 0,1'; END IF;
    INSERT INTO technologist_request_waste_items(completion_id,request_id,source_table,source_id,item_name,material_id,material_variant_id,material_name,material_grade,weight_snapshot_kg,waste_percent,scrap_weight_kg,useful_weight_kg)
    VALUES(v_completion,p_request_id,v_item->>'sourceTable',(v_item->>'sourceId')::uuid,coalesce(nullif(v_item->>'itemName',''),'Позиция'),nullif(v_item->>'materialId','')::uuid,nullif(v_item->>'materialVariantId','')::uuid,coalesce(nullif(v_item->>'materialName',''),'Металл'),nullif(v_item->>'materialGrade',''),v_weight,v_pct,round(v_weight*v_pct/100,3),round(v_weight-(v_weight*v_pct/100),3)) RETURNING id INTO v_part;
    INSERT INTO metal_scrap_lots(request_id,waste_item_id,machine_id,factory_id,created_by,material_id,material_variant_id,material_name,material_grade,expected_weight_kg)
    SELECT p_request_id,v_part,v_request.machine_id,v_machine.factory_id,p_actor,material_id,material_variant_id,material_name,material_grade,scrap_weight_kg FROM technologist_request_waste_items WHERE id=v_part RETURNING id INTO v_lot;
    INSERT INTO metal_scrap_movements(lot_id,movement_type,weight_delta_kg,available_after_kg,blocked_after_kg,sold_after_kg,performed_by)
    VALUES(v_lot,'planned',round(v_weight*v_pct/100,3),0,0,0,p_actor);
  END LOOP;

  INSERT INTO future_detailing_batches(request_id,machine_id,factory_id,created_by,status)
  VALUES(p_request_id,v_request.machine_id,v_machine.factory_id,p_actor,CASE WHEN p_decision='none' THEN 'cancelled' ELSE 'planned' END) RETURNING id INTO v_batch;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_future_items,'[]')) LOOP
    v_part := nullif(v_item->>'partId','')::uuid;
    IF v_part IS NULL THEN
      INSERT INTO detailing_parts(name,drawing_number,unit_weight_kg,created_by,updated_by)
      VALUES(v_item->>'name',v_item->>'drawingNumber',(v_item->>'unitWeightKg')::numeric,p_actor,p_actor) RETURNING id INTO v_part;
      INSERT INTO detailing_part_products(part_id,product_id,applies_to_all_versions)
      SELECT v_part,(x->>'productId')::uuid,(x->>'allVersions')::boolean FROM jsonb_array_elements(v_item->'compatibilities') x;
      INSERT INTO detailing_part_product_versions(part_product_id,product_version_id)
      SELECT dpp.id,(version_id)::uuid FROM jsonb_array_elements(v_item->'compatibilities') x JOIN detailing_part_products dpp ON dpp.part_id=v_part AND dpp.product_id=(x->>'productId')::uuid CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(x->'versionIds','[]')) version_id WHERE NOT dpp.applies_to_all_versions;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM detailing_parts WHERE id=v_part AND is_active) THEN RAISE EXCEPTION 'Карточка деталировки недоступна'; END IF;
    INSERT INTO future_detailing_items(batch_id,part_id,planned_quantity) VALUES(v_batch,v_part,(v_item->>'quantity')::integer);
  END LOOP;

  UPDATE technologist_requests SET status='submitted_to_supply',submitted_at=v_now,updated_at=v_now WHERE id=p_request_id;
  UPDATE machines SET status='request_ready',updated_at=v_now WHERE id=v_request.machine_id AND status='planned';
  RETURN v_completion;
END $$;

CREATE OR REPLACE FUNCTION public.future_detailing_on_cutting_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE future_detailing_batches SET status='awaiting_confirmation',first_cutting_event_id=NEW.id,confirmation_due_date=next_weekday(NEW.fact_date),updated_at=now()
  WHERE machine_id=NEW.machine_id AND status='planned';
  UPDATE future_detailing_items i SET status='awaiting_confirmation',updated_at=now() FROM future_detailing_batches b
  WHERE i.batch_id=b.id AND b.first_cutting_event_id=NEW.id AND i.status='planned';
  RETURN NEW;
END $$;
CREATE TRIGGER future_detailing_cutting_event AFTER INSERT ON public.production_fact_cutting_events FOR EACH ROW EXECUTE FUNCTION public.future_detailing_on_cutting_event();

CREATE OR REPLACE FUNCTION public.fn_correct_technologist_completion(p_request_id uuid,p_entered_plasma_minutes integer,p_waste_items jsonb,p_reason text,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_completion technologist_request_completions%ROWTYPE; v_item jsonb; v_waste technologist_request_waste_items%ROWTYPE; v_lot metal_scrap_lots%ROWTYPE; v_new_expected numeric; v_old jsonb;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Для корректировки обязательна причина'; END IF;
  SELECT * INTO v_completion FROM technologist_request_completions WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_completion.created_by<>p_actor OR p_entered_plasma_minutes<0 THEN RAISE EXCEPTION 'Корректировка недоступна'; END IF;
  v_old:=jsonb_build_object('enteredPlasmaMinutes',v_completion.entered_plasma_minutes,'actualPlasmaMinutes',v_completion.actual_plasma_minutes,'wasteItems',(SELECT jsonb_agg(to_jsonb(w)) FROM technologist_request_waste_items w WHERE w.request_id=p_request_id));
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_waste_items) LOOP
    SELECT * INTO v_waste FROM technologist_request_waste_items WHERE id=(v_item->>'wasteItemId')::uuid AND request_id=p_request_id FOR UPDATE;
    IF NOT FOUND OR (v_item->>'wastePercent')::numeric NOT BETWEEN 0 AND 100 OR (v_item->>'wastePercent')::numeric<>round((v_item->>'wastePercent')::numeric,1) THEN RAISE EXCEPTION 'Некорректная отходность'; END IF;
    v_new_expected:=round(v_waste.weight_snapshot_kg*(v_item->>'wastePercent')::numeric/100,3);
    SELECT * INTO v_lot FROM metal_scrap_lots WHERE waste_item_id=v_waste.id FOR UPDATE;
    IF v_new_expected<v_lot.sold_weight_kg THEN RAISE EXCEPTION 'Металлолом нельзя уменьшить ниже уже сданного веса'; END IF;
    UPDATE technologist_request_waste_items SET waste_percent=(v_item->>'wastePercent')::numeric,scrap_weight_kg=v_new_expected,useful_weight_kg=weight_snapshot_kg-v_new_expected WHERE id=v_waste.id;
    UPDATE metal_scrap_lots SET expected_weight_kg=v_new_expected,
      available_weight_kg=CASE WHEN status='available' THEN v_new_expected-sold_weight_kg ELSE available_weight_kg END,
      blocked_weight_kg=CASE WHEN status='review_required' THEN v_new_expected-sold_weight_kg ELSE blocked_weight_kg END,updated_at=now() WHERE id=v_lot.id RETURNING * INTO v_lot;
    INSERT INTO metal_scrap_movements(lot_id,movement_type,weight_delta_kg,available_after_kg,blocked_after_kg,sold_after_kg,reason,performed_by)
    VALUES(v_lot.id,'correction',v_new_expected-v_waste.scrap_weight_kg,v_lot.available_weight_kg,v_lot.blocked_weight_kg,v_lot.sold_weight_kg,p_reason,p_actor);
  END LOOP;
  UPDATE technologist_request_completions SET entered_plasma_minutes=p_entered_plasma_minutes,added_plasma_minutes=ceil(p_entered_plasma_minutes*0.25),actual_plasma_minutes=p_entered_plasma_minutes+ceil(p_entered_plasma_minutes*0.25),updated_at=now() WHERE id=v_completion.id;
  INSERT INTO technologist_completion_changes(request_id,change_type,old_value,new_value,reason,changed_by)
  VALUES(p_request_id,'waste',v_old,jsonb_build_object('enteredPlasmaMinutes',p_entered_plasma_minutes,'wasteItems',p_waste_items),p_reason,p_actor);
END $$;

CREATE OR REPLACE FUNCTION public.fn_materialize_due_future_detailing_tasks(p_today date DEFAULT current_date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  WITH due AS (SELECT b.* FROM future_detailing_batches b WHERE b.status='awaiting_confirmation' AND b.confirmation_due_date<=p_today AND b.confirmation_task_id IS NULL FOR UPDATE SKIP LOCKED), ins AS (
    INSERT INTO tasks(machine_id,assigned_to,task_type,title,description,status,start_date,deadline)
    SELECT machine_id,created_by,'future_detailing_confirmation','Подтвердить будущую деталировку','Подтвердите или скорректируйте фактическое количество после заготовки. Отклонение требует причину.','pending',confirmation_due_date,confirmation_due_date FROM due RETURNING id,machine_id,assigned_to
  ) UPDATE future_detailing_batches b SET confirmation_task_id=i.id,updated_at=now() FROM ins i WHERE b.machine_id=i.machine_id AND b.created_by=i.assigned_to AND b.status='awaiting_confirmation' AND b.confirmation_task_id IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.fn_correct_future_detailing_plan(p_batch_id uuid,p_items jsonb,p_reason text,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch future_detailing_batches%ROWTYPE; v_old jsonb; v_item jsonb; v_id uuid;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Для корректировки обязательна причина'; END IF;
  SELECT * INTO v_batch FROM future_detailing_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.created_by<>p_actor OR v_batch.status<>'planned' THEN RAISE EXCEPTION 'После первого факта план не редактируется'; END IF;
  v_old:=(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM future_detailing_items i WHERE i.batch_id=p_batch_id);
  UPDATE future_detailing_items SET status='cancelled',variance_reason=p_reason,updated_at=now() WHERE batch_id=p_batch_id AND status='planned';
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'quantity')::integer<=0 THEN RAISE EXCEPTION 'Количество должно быть больше нуля'; END IF;
    v_id:=nullif(v_item->>'itemId','')::uuid;
    IF v_id IS NOT NULL THEN
      UPDATE future_detailing_items SET planned_quantity=(v_item->>'quantity')::integer,status='planned',variance_reason=NULL,updated_at=now() WHERE id=v_id AND batch_id=p_batch_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Позиция плана не найдена'; END IF;
    ELSE
      INSERT INTO future_detailing_items(batch_id,part_id,planned_quantity) VALUES(p_batch_id,(v_item->>'partId')::uuid,(v_item->>'quantity')::integer)
      ON CONFLICT(batch_id,part_id) DO UPDATE SET planned_quantity=EXCLUDED.planned_quantity,status='planned',variance_reason=NULL,updated_at=now();
    END IF;
  END LOOP;
  INSERT INTO technologist_completion_changes(request_id,change_type,old_value,new_value,reason,changed_by)
  VALUES(v_batch.request_id,'future_detailing',v_old,p_items,p_reason,p_actor);
END $$;

CREATE OR REPLACE FUNCTION public.fn_confirm_future_detailing(p_batch_id uuid,p_actor uuid,p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch future_detailing_batches%ROWTYPE; v_item jsonb; v_row future_detailing_items%ROWTYPE; v_qty integer;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  SELECT * INTO v_batch FROM future_detailing_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.created_by<>p_actor OR v_batch.status<>'awaiting_confirmation' THEN RAISE EXCEPTION 'Подтверждение недоступно'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_row FROM future_detailing_items WHERE id=(v_item->>'itemId')::uuid AND batch_id=p_batch_id FOR UPDATE;
    v_qty := (v_item->>'actualQuantity')::integer;
    IF v_qty<0 THEN RAISE EXCEPTION 'Количество не может быть отрицательным'; END IF;
    IF v_qty<>v_row.planned_quantity AND btrim(coalesce(v_item->>'reason',''))='' THEN RAISE EXCEPTION 'Укажите причину изменения количества'; END IF;
    IF v_qty>0 THEN
      INSERT INTO detailing_balances(part_id,factory_id,on_hand_quantity,reserved_quantity,updated_by) VALUES(v_row.part_id,v_batch.factory_id,v_qty,0,p_actor)
      ON CONFLICT(part_id,factory_id) DO UPDATE SET on_hand_quantity=detailing_balances.on_hand_quantity+EXCLUDED.on_hand_quantity,updated_by=p_actor,updated_at=now();
      INSERT INTO detailing_movements(part_id,factory_id,movement_type,quantity_delta,reserved_delta,on_hand_after,reserved_after,comment,performed_by,machine_id)
      SELECT v_row.part_id,v_batch.factory_id,'receipt',v_qty,0,on_hand_quantity,reserved_quantity,'Поступление подтверждённой будущей деталировки',p_actor,v_batch.machine_id FROM detailing_balances WHERE part_id=v_row.part_id AND factory_id=v_batch.factory_id;
    END IF;
    UPDATE future_detailing_items SET actual_quantity=v_qty,status=CASE WHEN v_qty=0 THEN 'cancelled' ELSE 'confirmed' END,variance_reason=nullif(v_item->>'reason',''),updated_at=now() WHERE id=v_row.id;
  END LOOP;
  IF EXISTS(SELECT 1 FROM future_detailing_items WHERE batch_id=p_batch_id AND status='awaiting_confirmation') THEN RAISE EXCEPTION 'Подтвердите все позиции'; END IF;
  UPDATE future_detailing_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM future_detailing_items WHERE batch_id=p_batch_id AND status='confirmed') THEN 'confirmed' ELSE 'cancelled' END,confirmed_at=now(),updated_at=now() WHERE id=p_batch_id;
  UPDATE tasks SET status='completed',completed_at=now(),updated_at=now() WHERE id=v_batch.confirmation_task_id AND status IN ('pending','in_progress');
END $$;

CREATE OR REPLACE FUNCTION public.metal_scrap_on_cutting_end() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid; v_task uuid;
BEGIN
  IF NEW.stage_type<>'cutting' THEN RETURN NEW; END IF;
  SELECT created_by INTO v_actor FROM machines WHERE id=NEW.machine_id;
  IF NEW.date_end IS NOT NULL AND (OLD.date_end IS NULL OR OLD.date_end=NEW.date_end) THEN
    UPDATE metal_scrap_lots SET status='available',available_weight_kg=expected_weight_kg-sold_weight_kg,blocked_weight_kg=0,promoted_stage_end=NEW.date_end,updated_at=now() WHERE machine_id=NEW.machine_id AND status='future';
  ELSIF OLD.date_end IS NOT NULL AND NEW.date_end IS DISTINCT FROM OLD.date_end THEN
    UPDATE metal_scrap_lots SET status='review_required',blocked_weight_kg=available_weight_kg,available_weight_kg=0,updated_at=now() WHERE machine_id=NEW.machine_id AND status='available' AND available_weight_kg>0;
    SELECT tr.created_by INTO v_actor FROM technologist_requests tr WHERE tr.machine_id=NEW.machine_id;
    IF v_actor IS NOT NULL AND EXISTS(SELECT 1 FROM metal_scrap_lots WHERE machine_id=NEW.machine_id AND status='review_required') THEN
      INSERT INTO tasks(machine_id,assigned_to,task_type,title,description,status,start_date,deadline)
      VALUES(NEW.machine_id,v_actor,'metal_scrap_review','Перепроверить металлолом','Дата окончания заготовки изменена. Подтвердите или скорректируйте несданный остаток.','pending',current_date,current_date)
      ON CONFLICT(machine_id,assigned_to,task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress')
      DO UPDATE SET updated_at=now() RETURNING id INTO v_task;
      UPDATE metal_scrap_lots SET review_task_id=v_task WHERE machine_id=NEW.machine_id AND status='review_required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER metal_scrap_cutting_end AFTER UPDATE OF date_end ON public.production_stages FOR EACH ROW EXECUTE FUNCTION public.metal_scrap_on_cutting_end();

CREATE OR REPLACE FUNCTION public.fn_review_metal_scrap_lot(p_lot_id uuid,p_actual_weight_kg numeric,p_reason text,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lot metal_scrap_lots%ROWTYPE; v_old_expected numeric;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  SELECT * INTO v_lot FROM metal_scrap_lots WHERE id=p_lot_id FOR UPDATE;
  IF NOT FOUND OR v_lot.created_by<>p_actor OR v_lot.status<>'review_required' THEN RAISE EXCEPTION 'Перепроверка недоступна'; END IF;
  IF p_actual_weight_kg<v_lot.sold_weight_kg THEN RAISE EXCEPTION 'Вес нельзя уменьшить ниже уже сданного'; END IF;
  IF p_actual_weight_kg<>v_lot.expected_weight_kg AND btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Укажите причину корректировки'; END IF;
  v_old_expected:=v_lot.expected_weight_kg;
  UPDATE metal_scrap_lots SET expected_weight_kg=p_actual_weight_kg,available_weight_kg=p_actual_weight_kg-sold_weight_kg,blocked_weight_kg=0,status='available',updated_at=now() WHERE id=p_lot_id RETURNING * INTO v_lot;
  INSERT INTO metal_scrap_movements(lot_id,movement_type,weight_delta_kg,available_after_kg,blocked_after_kg,sold_after_kg,reason,performed_by)
  VALUES(v_lot.id,'reviewed',p_actual_weight_kg-v_old_expected,v_lot.available_weight_kg,0,v_lot.sold_weight_kg,nullif(p_reason,''),p_actor);
  IF NOT EXISTS(SELECT 1 FROM metal_scrap_lots WHERE review_task_id=v_lot.review_task_id AND status='review_required') THEN
    UPDATE tasks SET status='completed',completed_at=now(),updated_at=now() WHERE id=v_lot.review_task_id AND status IN ('pending','in_progress');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sell_metal_scrap(p_factory_id uuid,p_sale_date date,p_amount_uah numeric,p_buyer text,p_document text,p_comment text,p_items jsonb,p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sale uuid; v_item jsonb; v_lot metal_scrap_lots%ROWTYPE; v_qty numeric; v_total numeric:=0;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  IF p_sale_date IS NULL OR p_amount_uah<0 OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Заполните дату, вес и сумму'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_lot FROM metal_scrap_lots WHERE id=(v_item->>'lotId')::uuid FOR UPDATE;
    v_qty:=(v_item->>'weightKg')::numeric;
    IF v_lot.factory_id<>p_factory_id OR v_lot.status<>'available' OR v_qty<=0 OR v_qty>v_lot.available_weight_kg THEN RAISE EXCEPTION 'Недостаточный или недоступный остаток'; END IF;
    v_total:=v_total+v_qty;
  END LOOP;
  INSERT INTO metal_scrap_sales(factory_id,sale_date,total_weight_kg,amount_uah,buyer,document_number,comment,created_by) VALUES(p_factory_id,p_sale_date,v_total,p_amount_uah,nullif(btrim(p_buyer),''),nullif(btrim(p_document),''),nullif(btrim(p_comment),''),p_actor) RETURNING id INTO v_sale;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'weightKg')::numeric;
    UPDATE metal_scrap_lots SET available_weight_kg=available_weight_kg-v_qty,sold_weight_kg=sold_weight_kg+v_qty,updated_at=now() WHERE id=(v_item->>'lotId')::uuid RETURNING * INTO v_lot;
    INSERT INTO metal_scrap_sale_items(sale_id,lot_id,weight_kg) VALUES(v_sale,v_lot.id,v_qty);
    INSERT INTO metal_scrap_movements(lot_id,sale_id,movement_type,weight_delta_kg,available_after_kg,blocked_after_kg,sold_after_kg,performed_by) VALUES(v_lot.id,v_sale,'sale',-v_qty,v_lot.available_weight_kg,v_lot.blocked_weight_kg,v_lot.sold_weight_kg,p_actor);
  END LOOP;
  INSERT INTO metal_scrap_finance_incomes(sale_id,amount_uah,payment_date) VALUES(v_sale,p_amount_uah,p_sale_date);
  RETURN v_sale;
END $$;

CREATE OR REPLACE FUNCTION public.fn_cancel_metal_scrap_sale(p_sale_id uuid,p_reason text,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sale metal_scrap_sales%ROWTYPE; v_item record; v_lot metal_scrap_lots%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_actor<>auth.uid() OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Для отмены обязательна причина'; END IF;
  SELECT * INTO v_sale FROM metal_scrap_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.status<>'completed' THEN RAISE EXCEPTION 'Сдача уже отменена или не найдена'; END IF;
  FOR v_item IN SELECT * FROM metal_scrap_sale_items WHERE sale_id=p_sale_id FOR UPDATE LOOP
    UPDATE metal_scrap_lots SET available_weight_kg=available_weight_kg+v_item.weight_kg,sold_weight_kg=sold_weight_kg-v_item.weight_kg,updated_at=now() WHERE id=v_item.lot_id RETURNING * INTO v_lot;
    INSERT INTO metal_scrap_movements(lot_id,sale_id,movement_type,weight_delta_kg,available_after_kg,blocked_after_kg,sold_after_kg,reason,performed_by) VALUES(v_lot.id,p_sale_id,'sale_cancelled',v_item.weight_kg,v_lot.available_weight_kg,v_lot.blocked_weight_kg,v_lot.sold_weight_kg,p_reason,p_actor);
  END LOOP;
  UPDATE metal_scrap_sales SET status='cancelled',cancelled_by=p_actor,cancelled_at=now(),cancellation_reason=p_reason WHERE id=p_sale_id;
  UPDATE metal_scrap_finance_incomes SET status='cancelled',cancelled_at=now() WHERE sale_id=p_sale_id;
END $$;

ALTER TABLE public.technologist_request_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technologist_request_waste_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.future_detailing_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.future_detailing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technologist_completion_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_scrap_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_scrap_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_scrap_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_scrap_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_scrap_finance_incomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.technologist_request_completions,public.technologist_request_waste_items,public.future_detailing_batches,public.future_detailing_items,public.technologist_completion_changes,public.metal_scrap_lots,public.metal_scrap_sales,public.metal_scrap_sale_items,public.metal_scrap_movements,public.metal_scrap_finance_incomes FROM anon;
GRANT SELECT ON public.technologist_request_completions,public.technologist_request_waste_items,public.future_detailing_batches,public.future_detailing_items,public.technologist_completion_changes,public.metal_scrap_lots,public.metal_scrap_sales,public.metal_scrap_sale_items,public.metal_scrap_movements,public.metal_scrap_finance_incomes TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb),public.fn_correct_technologist_completion(uuid,integer,jsonb,text,uuid),public.fn_correct_future_detailing_plan(uuid,jsonb,text,uuid),public.fn_confirm_future_detailing(uuid,uuid,jsonb),public.fn_review_metal_scrap_lot(uuid,numeric,text,uuid),public.fn_sell_metal_scrap(uuid,date,numeric,text,text,text,jsonb,uuid),public.fn_cancel_metal_scrap_sale(uuid,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_materialize_due_future_detailing_tasks(date) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_materialize_due_future_detailing_tasks(date) TO service_role;

CREATE POLICY completion_owner_select ON public.technologist_request_completions FOR SELECT TO authenticated USING (created_by=auth.uid());
CREATE POLICY waste_owner_select ON public.technologist_request_waste_items FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM technologist_request_completions c WHERE c.id=completion_id AND c.created_by=auth.uid()));
CREATE POLICY future_detailing_owner_select ON public.future_detailing_batches FOR SELECT TO authenticated USING (created_by=auth.uid());
CREATE POLICY future_detailing_items_owner_select ON public.future_detailing_items FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM future_detailing_batches b WHERE b.id=batch_id AND b.created_by=auth.uid()));
