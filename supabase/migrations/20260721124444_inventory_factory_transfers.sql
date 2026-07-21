ALTER TYPE public.inventory_transaction_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE public.inventory_transaction_type ADD VALUE IF NOT EXISTS 'transfer_in';
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'inventory_transfer';
