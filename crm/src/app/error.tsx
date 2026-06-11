"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCcw, Home } from "lucide-react"
import { useRouter } from "next/navigation"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error("Global Error Caught:", error)
  }, [error])

  return (
    <html lang="ru">
      <body className="bg-[#F4F6F9] text-[#374151] antialiased min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-[#E8ECF0] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] p-6 text-center space-y-6">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-[#DC2626]" />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Критическая ошибка</h1>
            <p className="text-sm text-[#6B7280]">
              Произошла непредвиденная ошибка на стороне приложения.
            </p>
            {error.message && (
              <div className="mt-4 p-3 bg-[#FAFBFC] rounded-lg text-left text-xs font-mono text-[#DC2626] overflow-auto max-h-32 border border-[#E8ECF0]">
                {error.message}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#E8ECF0]">
            <Button 
              variant="outline" 
              onClick={() => reset()}
              className="border-[#E8ECF0] text-[#1B3A6B] hover:bg-[#F4F6F9]"
            >
              <RefreshCcw className="w-4 h-4 mr-2" />
              Попробовать снова
            </Button>
            <Button 
              onClick={() => router.push('/dashboard')}
              className="bg-[#1B3A6B] text-white hover:bg-[#152D54]"
            >
              <Home className="w-4 h-4 mr-2" />
              На главную
            </Button>
          </div>
        </div>
      </body>
    </html>
  )
}
