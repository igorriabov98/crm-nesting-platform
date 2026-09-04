-- Keep the enum change isolated: PostgreSQL cannot safely use a newly added
-- enum value elsewhere in the same migration transaction.

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'client_delivery_date';

SELECT pg_notify('pgrst', 'reload schema');
