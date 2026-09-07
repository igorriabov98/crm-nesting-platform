'use client'

import Link from 'next/link'
import { CalendarClock, ClipboardList } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ROUTES } from '@/lib/constants/routes'
import type { ReservationOrderDetails } from '@/lib/inventory/reservation-order-details'

const RESERVATION_TIME_ZONE = 'Europe/Chisinau'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: string
  location: string
  totalLabel: string
  unit: string
  secondaryUnit?: string | null
  reservations: ReservationOrderDetails[]
}

export function ReservationOrdersDialog({
  open,
  onOpenChange,
  subject,
  location,
  totalLabel,
  unit,
  secondaryUnit,
  reservations,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto border-[#DCE3EC] bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg text-[#1B3A6B]">Бронь по заказам</DialogTitle>
          <DialogDescription>{subject} · {location}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-[#DCE5F1] bg-[#F7FAFE] p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Всего забронировано</div>
          <div className="mt-1 text-lg font-semibold text-[#1B3A6B]">{totalLabel}</div>
        </div>

        <ReservationOrdersList reservations={reservations} unit={unit} secondaryUnit={secondaryUnit} onNavigate={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

export function ReservationOrdersList({
  reservations,
  unit,
  secondaryUnit,
  onNavigate,
}: {
  reservations: ReservationOrderDetails[]
  unit: string
  secondaryUnit?: string | null
  onNavigate?: () => void
}) {
  if (reservations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#CBD5E1] p-5 text-center text-sm text-[#6B7280]">
        Активные бронирования по заказам не найдены.
      </div>
    )
  }

  return (
    <div className="space-y-2" aria-label="Заказы с активной бронью">
      {reservations.map((reservation) => (
        <div key={reservation.machineId} className="rounded-lg border border-[#E1E7EF] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[#6B7280]">
                <ClipboardList className="h-4 w-4" />Заказ
              </div>
              <Link
                href={`${ROUTES.SALES_PLAN}/${reservation.machineId}`}
                onClick={onNavigate}
                className="mt-1 block truncate font-semibold text-[#1B3A6B] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]"
              >
                {reservation.machineName}
              </Link>
            </div>
            <div className="shrink-0 text-right font-semibold text-[#A66B13]">
              {formatReservationQuantity(reservation.quantity, unit, reservation.secondaryQuantity, secondaryUnit)}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-[#6B7280]">
            <CalendarClock className="h-3.5 w-3.5" />Бронь с {formatReservationDateTime(reservation.reservedAt)}
            {reservation.reservationCount > 1 ? ` · записей: ${reservation.reservationCount}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

export function formatReservationQuantity(quantity: number, unit: string, secondaryQuantity?: number | null, secondaryUnit?: string | null) {
  const primary = `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(quantity)} ${unit}`
  if (secondaryQuantity === null || secondaryQuantity === undefined || !secondaryUnit) return primary
  return `${primary} / ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(secondaryQuantity)} ${secondaryUnit}`
}

function formatReservationDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: RESERVATION_TIME_ZONE,
  }).format(new Date(value))
}
