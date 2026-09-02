-- Logistics fields used by machine settings and the shipment report.
-- Historical zero freight values are intentionally preserved; the application
-- renders them as unspecified while new writes require a positive amount.
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS customs_clearance_date date;

ALTER TABLE public.machines
  ALTER COLUMN freight_cost DROP DEFAULT;

COMMENT ON COLUMN public.machines.customs_clearance_date IS
  'Date when the shipment cleared customs.';

COMMENT ON COLUMN public.machines.freight_cost IS
  'Actual transport cost in EUR. Informational only; excluded from invoices and generated documents.';

-- Invoice creation must be an explicit, permission-checked server action.
-- The legacy SECURITY DEFINER trigger could otherwise create or update an
-- invoice when a user with only sales-plan access saved the delivery date.
DROP TRIGGER IF EXISTS trg_upsert_invoice_on_delivery ON public.machines;
DROP FUNCTION IF EXISTS public.fn_upsert_invoice_on_delivery();
