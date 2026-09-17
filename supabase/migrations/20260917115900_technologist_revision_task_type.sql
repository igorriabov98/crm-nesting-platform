-- PostgreSQL requires a new enum value to be committed before a later
-- transaction can use it in the returned-version backfill.
alter type public.task_type add value if not exists 'technologist_request_revision';
