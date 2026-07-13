import { Bell } from 'lucide-react'

import {
  DEFAULT_NOTIFICATION_ICON,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '@/lib/constants/notifications'
import { cn } from '@/lib/utils'

type NotificationGlyphProps = {
  type: string
  className?: string
  iconClassName?: string
}

function getTone(type: string) {
  if (
    type.includes('overdue') ||
    type.includes('shortage') ||
    type.includes('variance')
  ) {
    return 'bg-red-50 text-red-600 ring-red-100'
  }

  if (
    type.includes('confirmed') ||
    type.includes('ready') ||
    type.includes('shipped')
  ) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
  }

  if (type.startsWith('consumable_request_')) {
    return 'bg-violet-50 text-violet-700 ring-violet-100'
  }

  return 'bg-blue-50 text-blue-700 ring-blue-100'
}

export function NotificationGlyph({
  type,
  className,
  iconClassName,
}: NotificationGlyphProps) {
  const config =
    NOTIFICATION_TYPES[type as NotificationType] || DEFAULT_NOTIFICATION_ICON
  const Icon = config.icon || Bell

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1',
        getTone(type),
        className
      )}
    >
      <Icon className={cn('size-5', iconClassName)} />
    </span>
  )
}
