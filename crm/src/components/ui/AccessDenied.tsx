import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { ShieldAlert } from 'lucide-react'

export function AccessDenied() {
  return (
    <div className="flex h-[80vh] flex-col items-center justify-center space-y-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
        <ShieldAlert className="h-10 w-10 text-red-500" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-[#1B3A6B]">🔒 Доступ запрещён</h1>
        <p className="text-[#6B7280]">У вас нет прав для просмотра этой страницы</p>
      </div>
      <Link href={ROUTES.DASHBOARD}>
        <Button variant="default" className="bg-blue-600 hover:bg-blue-700 text-[#1B3A6B]">
          На главную
        </Button>
      </Link>
    </div>
  )
}
