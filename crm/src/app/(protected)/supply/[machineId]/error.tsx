"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCcw } from "lucide-react"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Route Error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-white border border-[#E8ECF0] rounded-xl space-y-4 text-center">
      <AlertTriangle className="w-10 h-10 text-[#DC2626]" />
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-[#1B3A6B]">Что-то пошло не так!</h2>
        <p className="text-[#6B7280] text-sm">{error.message || "Ошибка загрузки модуля."}</p>
      </div>
      <Button 
        onClick={() => reset()}
        variant="outline"
        className="mt-4 border-[#E8ECF0] bg-[#F8F9FA] hover:bg-[#E8ECF0] text-[#1B3A6B]"
      >
        <RefreshCcw className="w-4 h-4 mr-2" />
        Попробовать снова
      </Button>
    </div>
  )
}
