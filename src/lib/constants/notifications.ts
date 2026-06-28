import { 
  Bell, 
  AlertTriangle, 
  CheckCircle,
  Clock, 
  Truck, 
  Package, 
  Plus, 
  Receipt,
  MessageSquare
} from 'lucide-react'

export const NOTIFICATION_TYPES = {
  // Новые задачи
  new_machine: {
    icon: Plus,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    label: 'Новая машина'
  },
  drawing_confirmed: {
    icon: CheckCircle,
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    label: 'Чертёж подтверждён'
  },
  nomenclature_ready: {
    icon: Package,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    label: 'Номенклатура готова'
  },

  // Дедлайны
  deadline_approaching: {
    icon: Clock,
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10',
    label: 'Дедлайн приближается'
  },

  // Просрочки
  supply_overdue: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    label: 'Просрочка поставки'
  },
  stage_overdue: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    label: 'Просрочка этапа'
  },
  invoice_overdue: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    label: 'Инвойс просрочен'
  },

  // Завершение
  machine_shipped: {
    icon: Truck,
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    label: 'Машина отгружена'
  },
  invoice_created: {
    icon: Receipt,
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
    label: 'Инвойс создан'
  },
  machine_chat_message: {
    icon: MessageSquare,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    label: 'Сообщение в чате машины'
  },
  consumable_request_new: {
    icon: Package,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    label: 'Новая заявка на расходники'
  },
  consumable_request_invoice_taken: {
    icon: Receipt,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    label: 'Счёт взят'
  },
  consumable_request_delivery: {
    icon: Truck,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    label: 'Доставка расходника'
  },
  consumable_request_shortage: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    label: 'Недопоставка расходника'
  },
  consumable_request_partial_receipt: {
    icon: Package,
    color: 'text-cyan-700',
    bg: 'bg-cyan-50',
    label: 'Частичное получение'
  },
  material_receipt_variance: {
    icon: AlertTriangle,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    label: 'Расхождение приемки'
  },
} as const

// Default fallback icon
export const DEFAULT_NOTIFICATION_ICON = {
  icon: Bell,
  color: 'text-slate-400',
  bg: 'bg-slate-800',
  label: 'Уведомление'
}

export type NotificationType = keyof typeof NOTIFICATION_TYPES
