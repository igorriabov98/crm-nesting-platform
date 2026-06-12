"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return "Произошла ошибка"
}

export function useLoading() {
  const [loading, setLoading] = useState(false)

  const withLoading = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      options?: {
        successMessage?: string
        errorMessage?: string
      }
    ): Promise<T | undefined> => {
      setLoading(true)
      try {
        const result = await fn()
        if (options?.successMessage) toast.success(options.successMessage)
        return result
      } catch (error) {
        toast.error(options?.errorMessage || getErrorMessage(error))
        console.error(error)
        return undefined
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { loading, withLoading }
}
