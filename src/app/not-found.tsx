"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FileQuestion, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F6F9] p-4">
      <div className="w-full max-w-md bg-white border border-[#E8ECF0] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-[#F4F6F9] rounded-full flex items-center justify-center mx-auto">
          <FileQuestion className="w-10 h-10 text-[#9CA3AF]" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-4xl font-black text-[#1B3A6B] tracking-tight">404</h1>
          <h2 className="text-xl font-semibold text-[#374151]">Страница не найдена</h2>
          <p className="text-sm text-[#6B7280] max-w-xs mx-auto">
            К сожалению, мы не смогли найти запрашиваемую страницу. Возможно, она была удалена или вы ввели неверный адрес.
          </p>
        </div>

        <div className="pt-4 flex justify-center">
          <Link href="/dashboard">
            <Button size="lg" className="bg-[#1B3A6B] hover:bg-[#152D54] text-white shadow-md">
              <Home className="w-4 h-4 mr-2" />
              Вернуться на главную
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
