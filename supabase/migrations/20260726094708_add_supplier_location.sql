ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN public.suppliers.city IS 'City used for supplier and outsourcing transport routes';
COMMENT ON COLUMN public.suppliers.address IS 'Street address used as the transport pickup or delivery point';
