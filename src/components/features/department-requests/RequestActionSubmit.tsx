'use client'

import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function RequestActionSubmit({
  value,
  children,
  variant = 'outline',
}: {
  value: 'in_progress' | 'done' | 'rejected' | 'cancelled'
  children: React.ReactNode
  variant?: 'default' | 'outline' | 'destructive'
}) {
  const { pending, data } = useFormStatus()
  const isSubmitting = pending && data?.get('status') === value

  return (
    <Button
      type="submit"
      name="status"
      value={value}
      variant={variant}
      disabled={pending}
      className="min-h-11"
    >
      {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}
