-- PostgreSQL enum values must be committed before later migrations can use them.
alter type public.request_status add value if not exists 'cancelled';

