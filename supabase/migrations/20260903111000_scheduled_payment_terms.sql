-- Recurring payment dates after delivery. Company settings are copied to each
-- invoice at issuance so later company edits cannot rewrite issued terms.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scheduled_payment_amount_mode') THEN
    CREATE TYPE public.scheduled_payment_amount_mode AS ENUM ('full_balance', 'fixed_amount');
  END IF;
END $$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS scheduled_payment_weekdays integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_payment_month_days integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_payment_amount_mode public.scheduled_payment_amount_mode NOT NULL DEFAULT 'full_balance',
  ADD COLUMN IF NOT EXISTS scheduled_payment_minimum_amount numeric(14,2);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS scheduled_payment_weekdays_snapshot integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_payment_month_days_snapshot integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_payment_amount_mode_snapshot public.scheduled_payment_amount_mode NOT NULL DEFAULT 'full_balance',
  ADD COLUMN IF NOT EXISTS scheduled_payment_minimum_amount_snapshot numeric(14,2);

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_scheduled_payment_weekdays_check,
  DROP CONSTRAINT IF EXISTS clients_scheduled_payment_month_days_check,
  DROP CONSTRAINT IF EXISTS clients_scheduled_payment_dates_check,
  DROP CONSTRAINT IF EXISTS clients_scheduled_payment_minimum_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_scheduled_payment_weekdays_check
    CHECK (scheduled_payment_weekdays <@ ARRAY[1,2,3,4,5,6,7]),
  ADD CONSTRAINT clients_scheduled_payment_month_days_check
    CHECK (scheduled_payment_month_days <@ ARRAY[
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
      17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
    ]),
  ADD CONSTRAINT clients_scheduled_payment_dates_check
    CHECK (
      payment_terms_type <> 'scheduled_after_delivery'::public.payment_terms_type
      OR cardinality(scheduled_payment_weekdays) + cardinality(scheduled_payment_month_days) > 0
    ),
  ADD CONSTRAINT clients_scheduled_payment_minimum_check
    CHECK (
      (scheduled_payment_minimum_amount IS NULL OR scheduled_payment_minimum_amount > 0)
      AND (
        payment_terms_type <> 'scheduled_after_delivery'::public.payment_terms_type
        OR scheduled_payment_amount_mode <> 'fixed_amount'::public.scheduled_payment_amount_mode
        OR scheduled_payment_minimum_amount > 0
      )
    );

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_scheduled_payment_weekdays_check,
  DROP CONSTRAINT IF EXISTS invoices_scheduled_payment_month_days_check,
  DROP CONSTRAINT IF EXISTS invoices_scheduled_payment_dates_check,
  DROP CONSTRAINT IF EXISTS invoices_scheduled_payment_minimum_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_scheduled_payment_weekdays_check
    CHECK (scheduled_payment_weekdays_snapshot <@ ARRAY[1,2,3,4,5,6,7]),
  ADD CONSTRAINT invoices_scheduled_payment_month_days_check
    CHECK (scheduled_payment_month_days_snapshot <@ ARRAY[
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
      17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
    ]),
  ADD CONSTRAINT invoices_scheduled_payment_dates_check
    CHECK (
      payment_terms_type_snapshot IS NULL
      OR payment_terms_type_snapshot <> 'scheduled_after_delivery'::public.payment_terms_type
      OR cardinality(scheduled_payment_weekdays_snapshot) + cardinality(scheduled_payment_month_days_snapshot) > 0
    ),
  ADD CONSTRAINT invoices_scheduled_payment_minimum_check
    CHECK (
      (scheduled_payment_minimum_amount_snapshot IS NULL OR scheduled_payment_minimum_amount_snapshot > 0)
      AND (
        payment_terms_type_snapshot IS NULL
        OR payment_terms_type_snapshot <> 'scheduled_after_delivery'::public.payment_terms_type
        OR scheduled_payment_amount_mode_snapshot <> 'fixed_amount'::public.scheduled_payment_amount_mode
        OR scheduled_payment_minimum_amount_snapshot > 0
      )
    );

CREATE OR REPLACE FUNCTION public.fn_next_scheduled_payment_date(
  p_after_date date,
  p_weekdays integer[],
  p_month_days integer[]
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  candidate date;
  last_month_day integer;
  offset_days integer;
BEGIN
  IF cardinality(p_weekdays) + cardinality(p_month_days) = 0 THEN
    RETURN NULL;
  END IF;

  FOR offset_days IN 1..370 LOOP
    candidate := p_after_date + offset_days;
    last_month_day := EXTRACT(day FROM (date_trunc('month', candidate) + interval '1 month - 1 day'))::integer;

    IF EXTRACT(isodow FROM candidate)::integer = ANY(p_weekdays)
      OR EXISTS (
        SELECT 1
        FROM unnest(p_month_days) AS selected_day
        WHERE LEAST(selected_day, last_month_day) = EXTRACT(day FROM candidate)::integer
      )
    THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_scheduled_payment_date_at(
  p_after_date date,
  p_weekdays integer[],
  p_month_days integer[],
  p_sequence integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  result_date date := p_after_date;
  sequence_number integer;
BEGIN
  IF p_sequence < 1 THEN
    RETURN NULL;
  END IF;

  FOR sequence_number IN 1..p_sequence LOOP
    result_date := public.fn_next_scheduled_payment_date(result_date, p_weekdays, p_month_days);
    IF result_date IS NULL THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN result_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_scheduled_payment_due_date(
  p_delivery_date date,
  p_weekdays integer[],
  p_month_days integer[],
  p_amount numeric,
  p_paid_amount numeric,
  p_amount_mode public.scheduled_payment_amount_mode,
  p_minimum_amount numeric
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  sequence_number integer;
BEGIN
  IF p_delivery_date IS NULL OR COALESCE(p_paid_amount, 0) >= COALESCE(p_amount, 0) THEN
    RETURN NULL;
  END IF;

  IF p_amount_mode = 'full_balance'::public.scheduled_payment_amount_mode THEN
    sequence_number := 1;
  ELSE
    IF p_minimum_amount IS NULL OR p_minimum_amount <= 0 THEN
      RETURN NULL;
    END IF;
    sequence_number := FLOOR(COALESCE(p_paid_amount, 0) / p_minimum_amount)::integer + 1;
  END IF;

  RETURN public.fn_scheduled_payment_date_at(
    p_delivery_date,
    COALESCE(p_weekdays, '{}'),
    COALESCE(p_month_days, '{}'),
    sequence_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_scheduled_payment_overdue_amount(
  p_delivery_date date,
  p_weekdays integer[],
  p_month_days integer[],
  p_amount numeric,
  p_paid_amount numeric,
  p_amount_mode public.scheduled_payment_amount_mode,
  p_minimum_amount numeric,
  p_as_of date DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Uzhgorod')::date)
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  occurrence date;
  occurrence_count integer := 0;
  expected_amount numeric(14,2) := 0;
BEGIN
  IF p_delivery_date IS NULL OR COALESCE(p_amount, 0) <= 0 THEN
    RETURN 0;
  END IF;

  occurrence := public.fn_next_scheduled_payment_date(
    p_delivery_date,
    COALESCE(p_weekdays, '{}'),
    COALESCE(p_month_days, '{}')
  );

  IF occurrence IS NULL OR occurrence >= p_as_of THEN
    RETURN 0;
  END IF;

  IF p_amount_mode = 'full_balance'::public.scheduled_payment_amount_mode THEN
    expected_amount := p_amount;
  ELSE
    IF p_minimum_amount IS NULL OR p_minimum_amount <= 0 THEN
      RETURN 0;
    END IF;
    WHILE occurrence IS NOT NULL AND occurrence < p_as_of AND occurrence_count < 10000 LOOP
      occurrence_count := occurrence_count + 1;
      occurrence := public.fn_next_scheduled_payment_date(
        occurrence,
        COALESCE(p_weekdays, '{}'),
        COALESCE(p_month_days, '{}')
      );
    END LOOP;
    expected_amount := LEAST(p_amount, occurrence_count * p_minimum_amount);
  END IF;

  RETURN GREATEST(ROUND(expected_amount - COALESCE(p_paid_amount, 0), 2), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_invoice_payment_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  machine_row public.machines%ROWTYPE;
  paid_total numeric(14,2);
  completed_on date;
  exact_due_date date;
BEGIN
  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO machine_row
  FROM public.machines
  WHERE id = invoice_row.machine_id;

  SELECT COALESCE(SUM(amount), 0), MAX(paid_on)
  INTO paid_total, completed_on
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id
    AND voided_at IS NULL;

  IF paid_total > invoice_row.amount THEN
    RAISE EXCEPTION 'Payment total exceeds invoice amount';
  END IF;

  exact_due_date := NULL;
  IF invoice_row.payment_terms_type_snapshot = 'invoice_days'::public.payment_terms_type THEN
    exact_due_date := invoice_row.invoice_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
  ELSIF invoice_row.payment_terms_type_snapshot = 'delivery_days'::public.payment_terms_type
    AND machine_row.delivery_to_client_date IS NOT NULL THEN
    exact_due_date := machine_row.delivery_to_client_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
  ELSIF invoice_row.payment_terms_type_snapshot = 'prepayment_full'::public.payment_terms_type THEN
    IF paid_total < ROUND(invoice_row.amount * COALESCE(invoice_row.prepayment_percent_snapshot, 50) / 100, 2) THEN
      exact_due_date := invoice_row.invoice_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
    ELSIF machine_row.delivery_to_client_date IS NOT NULL THEN
      exact_due_date := machine_row.delivery_to_client_date + COALESCE(
        invoice_row.final_payment_due_days_snapshot,
        invoice_row.payment_due_days_snapshot,
        0
      );
    END IF;
  ELSIF invoice_row.payment_terms_type_snapshot = 'scheduled_after_delivery'::public.payment_terms_type THEN
    exact_due_date := public.fn_scheduled_payment_due_date(
      machine_row.delivery_to_client_date,
      invoice_row.scheduled_payment_weekdays_snapshot,
      invoice_row.scheduled_payment_month_days_snapshot,
      invoice_row.amount,
      paid_total,
      invoice_row.scheduled_payment_amount_mode_snapshot,
      invoice_row.scheduled_payment_minimum_amount_snapshot
    );
  END IF;

  UPDATE public.invoices
  SET
    paid_amount = paid_total,
    actual_paid_date = CASE WHEN paid_total > 0 THEN completed_on ELSE NULL END,
    payment_date = exact_due_date,
    due_date = exact_due_date,
    original_planned_date = exact_due_date,
    status = CASE
      WHEN status = 'cancelled'::public.invoice_status THEN status
      WHEN paid_total >= amount AND amount > 0 THEN 'paid'::public.invoice_status
      WHEN paid_total > 0 THEN 'partially_paid'::public.invoice_status
      ELSE 'not_paid'::public.invoice_status
    END,
    updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

DROP VIEW IF EXISTS public.client_list_summary;
CREATE VIEW public.client_list_summary
WITH (security_invoker = true)
AS
SELECT
  client.id,
  client.name,
  client.primary_contact_name,
  client.phone,
  client.email,
  client.country_city,
  client.payment_terms_type,
  client.payment_due_days,
  client.prepayment_percent,
  client.final_payment_due_days,
  client.responsible_user_id,
  client.estimated_delivery_days,
  client.scheduled_payment_weekdays,
  client.scheduled_payment_month_days,
  client.scheduled_payment_amount_mode,
  client.scheduled_payment_minimum_amount,
  COALESCE(machine_summary.active_machines_count, 0)::integer AS active_machines_count,
  COALESCE(invoice_summary.current_invoice_amount, 0)::numeric AS current_invoice_amount,
  COALESCE(invoice_summary.overdue_invoice_amount, 0)::numeric AS overdue_invoice_amount,
  GREATEST(client.updated_at, COALESCE(machine_summary.last_machine_activity, client.updated_at)) AS last_activity,
  client.updated_at
FROM public.clients client
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(machine.is_archived, false) = false)::integer AS active_machines_count,
    MAX(machine.updated_at) AS last_machine_activity
  FROM public.machines machine
  WHERE machine.client_id = client.id
) machine_summary ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(GREATEST(COALESCE(invoice.amount, 0) - COALESCE(invoice.paid_amount, 0), 0)) AS current_invoice_amount,
    SUM(
      CASE
        WHEN invoice.payment_terms_type_snapshot = 'scheduled_after_delivery'::public.payment_terms_type THEN
          public.fn_scheduled_payment_overdue_amount(
            machine.delivery_to_client_date,
            invoice.scheduled_payment_weekdays_snapshot,
            invoice.scheduled_payment_month_days_snapshot,
            invoice.amount,
            invoice.paid_amount,
            invoice.scheduled_payment_amount_mode_snapshot,
            invoice.scheduled_payment_minimum_amount_snapshot,
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Uzhgorod')::date
          )
        WHEN COALESCE(invoice.due_date, invoice.payment_date) < CURRENT_DATE THEN
          GREATEST(COALESCE(invoice.amount, 0) - COALESCE(invoice.paid_amount, 0), 0)
        ELSE 0
      END
    ) AS overdue_invoice_amount
  FROM public.machines machine
  JOIN public.invoices invoice ON invoice.machine_id = machine.id
  WHERE machine.client_id = client.id
    AND invoice.status <> 'cancelled'::public.invoice_status
    AND invoice.status <> 'paid'::public.invoice_status
) invoice_summary ON true;

GRANT SELECT ON public.client_list_summary TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_next_scheduled_payment_date(date, integer[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_scheduled_payment_date_at(date, integer[], integer[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_scheduled_payment_due_date(date, integer[], integer[], numeric, numeric, public.scheduled_payment_amount_mode, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_scheduled_payment_overdue_amount(date, integer[], integer[], numeric, numeric, public.scheduled_payment_amount_mode, numeric, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_invoice_payment_totals(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_next_scheduled_payment_date(date, integer[], integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_scheduled_payment_date_at(date, integer[], integer[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_scheduled_payment_due_date(date, integer[], integer[], numeric, numeric, public.scheduled_payment_amount_mode, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_scheduled_payment_overdue_amount(date, integer[], integer[], numeric, numeric, public.scheduled_payment_amount_mode, numeric, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_invoice_payment_totals(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_next_scheduled_payment_date(date, integer[], integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_scheduled_payment_overdue_amount(date, integer[], integer[], numeric, numeric, public.scheduled_payment_amount_mode, numeric, date) TO authenticated;

COMMENT ON COLUMN public.clients.scheduled_payment_weekdays IS
  'ISO weekdays (1 Monday through 7 Sunday) for recurring payment dates after delivery.';
COMMENT ON COLUMN public.clients.scheduled_payment_month_days IS
  'Calendar month days for recurring payments; unavailable days clamp to month end.';
COMMENT ON COLUMN public.invoices.scheduled_payment_weekdays_snapshot IS
  'Immutable copy of the client recurring weekday schedule at invoice issuance.';
