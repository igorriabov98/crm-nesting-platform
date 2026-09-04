-- PostgreSQL enum values must be committed before they are used by later
-- migrations. Keep this migration intentionally separate from the schema.
ALTER TYPE public.payment_terms_type
  ADD VALUE IF NOT EXISTS 'scheduled_after_delivery';
