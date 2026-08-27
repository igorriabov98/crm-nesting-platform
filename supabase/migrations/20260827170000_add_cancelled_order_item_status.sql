-- Cancelled request positions remain in their original technologist request as
-- history, but must no longer participate in procurement or receiving.
alter type public.order_item_status add value if not exists 'cancelled';
