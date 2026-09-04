"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"
import { breadcrumbLabelForSegment } from '@/lib/navigation/breadcrumbs'

export function Breadcrumbs() {
  const pathname = usePathname()

  if (pathname === "/dashboard" || pathname === "/") return null

  const segments = pathname.split("/").filter((s) => s.length > 0)

  return (
    <nav className="flex items-center text-[10px] sm:text-xs text-[#6B7280] mt-0.5 px-1 pb-1" aria-label="Навигационная цепочка">
      <ol className="flex items-center space-x-1.5">
        <li>
          <Link href="/dashboard" aria-label="На дашборд" className="hover:text-[#1B3A6B] transition-colors flex items-center">
            <Home className="w-3.5 h-3.5" />
          </Link>
        </li>

        {segments.map((segment, index) => {
          const href = "/" + segments.slice(0, index + 1).join("/")
          const isLast = index === segments.length - 1

          const label = breadcrumbLabelForSegment(segment)

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
