import { SupplyStatus, InvoiceStatus } from '@/lib/types'

export const SUPPLY_STATUSES: Record<
  SupplyStatus,
  { label: string; color: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  received: { label: 'Получено', color: 'green', variant: 'default' },
  ordered: { label: 'Заказано', color: 'yellow', variant: 'secondary' },
  not_ordered: { label: 'Не заказано', color: 'red', variant: 'destructive' },
}

export const INVOICE_STATUSES: Record<
  InvoiceStatus,
  { label: string; color: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  paid: { label: 'Оплачено', color: 'green', variant: 'default' },
  partially_paid: { label: 'Частично оплачено', color: 'blue', variant: 'outline' },
  not_paid: { label: 'Не оплачено', color: 'yellow', variant: 'secondary' },
  overdue: { label: 'Просрочено', color: 'red', variant: 'destructive' },
  cancelled: { label: 'Аннулировано', color: 'gray', variant: 'outline' },
}
