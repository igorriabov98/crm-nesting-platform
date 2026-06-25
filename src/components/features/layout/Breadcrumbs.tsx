"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"

const routeMap: Record<string, string> = {
  "dashboard": "Дашборд",
  "sales-plan": "План продаж",
  "new": "Создание",
  "production": "Производство",
  "gantt": "Гант-график",
  "consumables": "Расходники",
  "consumable-requests": "Заявки на расходники",
  "supply": "Снабжение",
  "production-requests": "Заявки производства",
  "inventory": "Склад",
  "receiving": "Прием материала",
  "invoices": "Инвойсы",
  "contracts": "Контракты",
  "notifications": "Уведомления",
  "admin": "Админ",
  "settings": "Настройки",
  "access": "Управление доступом",
  "departments": "Отделы и структура",
  "users": "Пользователи",
  "materials": "Материалы",
  "suppliers": "Поставщики",
}

export function Breadcrumbs() {
  const pathname = usePathname()

  if (pathname === "/dashboard" || pathname === "/") return null

  const segments = pathname.split("/").filter((s) => s.length > 0)

  return (
    <nav className="flex items-center text-[10px] sm:text-xs text-[#6B7280] mt-0.5 px-1 pb-1" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-1.5">
        <li>
          <Link href="/dashboard" aria-label="Go to dashboard" className="hover:text-[#1B3A6B] transition-colors flex items-center">
            <Home className="w-3.5 h-3.5" />
          </Link>
        </li>

        {segments.map((segment, index) => {
          const href = "/" + segments.slice(0, index + 1).join("/")
          const isLast = index === segments.length - 1

          const isId = segment.length > 20 && segment.includes("-")
          const label = isId ? "Детали" : (routeMap[segment] || segment)

          return (
            <li key={href} className="flex items-center space-x-2">
              <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
              {isLast ? (
                <span className="text-[#374151] font-medium cursor-default">{label}</span>
              ) : (
                <Link href={href} className="hover:text-[#1B3A6B] transition-colors">
                  {label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
