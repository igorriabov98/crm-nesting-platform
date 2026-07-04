import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { NestingStatus } from '@/lib/nesting/api'

const statusConfig: Record<NestingStatus, { label: string; className: string; icon: React.ElementType; spin?: boolean }> = {
  created: {
    label: 'Создан',
    className: 'bg-slate-100 text-slate-700',
    icon: Clock,
  },
  parsing: {
    label: 'Парсинг...',
    className: 'bg-amber-100 text-amber-700',
    icon: Loader2,
    spin: true,
  },
  parsed: {
    label: 'Готов к расчёту',
    className: 'bg-blue-100 text-blue-700',
    icon: CheckCircle2,
  },
  calculating: {
    label: 'Расчёт...',
    className: 'bg-amber-100 text-amber-700',
    icon: Loader2,
    spin: true,
  },
  done: {
    label: 'Готово',
    className: 'bg-emerald-100 text-emerald-700',
    icon: CheckCircle2,
  },
  completed_with_warnings: {
    label: 'Готово с предупреждениями',
    className: 'bg-amber-100 text-amber-800',
    icon: AlertTriangle,
  },
  error: {
    label: 'Ошибка',
    className: 'bg-red-100 text-red-700',
    icon: XCircle,
  },
}

export function StatusBadge({ status }: { status: NestingStatus | string }) {
  const config = statusConfig[status as NestingStatus] ?? statusConfig.created
  const Icon = config.icon

  return (
    <Badge variant="secondary" className={cn('border-transparent', config.className)}>
      <Icon className={cn('h-3 w-3', config.spin && 'animate-spin')} />
      {config.label}
    </Badge>
  )
}
