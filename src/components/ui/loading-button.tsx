"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ComponentProps, ReactNode } from "react"

type LoadingButtonProps = ComponentProps<typeof Button> & {
  loading?: boolean
  loadingText?: ReactNode
}

export function LoadingButton({
  loading = false,
  loadingText,
  children,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading && loadingText ? loadingText : children}
    </Button>
  )
}
