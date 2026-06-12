'use client'

import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function BigSaveButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="h-14 w-full text-lg font-semibold"
    >
      {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
      Сохранить
    </Button>
  )
}
