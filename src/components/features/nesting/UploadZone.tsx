'use client'

import { useRef, useState } from 'react'
import { FileCheck2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

export function UploadZone({
  title,
  description,
  accept,
  file,
  error,
  disabled,
  onFile,
}: {
  title: string
  description: string
  accept: string
  file: File | null
  error?: string | null
  disabled?: boolean
  onFile: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleFile(nextFile?: File) {
    if (disabled) return
    onFile(nextFile ?? null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          handleFile(event.dataTransfer.files?.[0])
        }}
        className={cn(
          'flex min-h-[150px] w-full flex-col items-center justify-center rounded-lg border border-dashed bg-white p-6 text-center transition',
          isDragging && 'scale-[1.01] border-blue-500 bg-blue-50',
          file && 'border-emerald-300 bg-emerald-50/50',
          error && 'border-red-400 bg-red-50',
          disabled && 'cursor-not-allowed opacity-70'
        )}
      >
        {file ? (
          <>
            <FileCheck2 className="h-8 w-8 text-emerald-600" />
            <span className="mt-3 text-sm font-medium text-[#1B3A6B]">{file.name}</span>
            <span className="mt-1 text-xs text-[#6B7280]">{formatBytes(file.size)}</span>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-[#1B3A6B]" />
            <span className="mt-3 text-sm font-medium text-[#1B3A6B]">{title}</span>
            <span className="mt-1 text-xs text-[#6B7280]">{description}</span>
          </>
        )}
      </button>
      {file && !disabled && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 text-[#6B7280]" onClick={() => handleFile()}>
          <X className="h-4 w-4" />
          Убрать файл
        </Button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
