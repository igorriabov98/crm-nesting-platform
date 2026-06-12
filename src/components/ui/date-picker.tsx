"use client"

import * as React from "react"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  displayFormat?: string
  allowClear?: boolean
  popoverClassName?: string
}

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Выберите дату",
  className,
  displayFormat = "dd.MM.yyyy",
  allowClear = true,
  popoverClassName,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal bg-white border-[#E8ECF0] text-[#1B3A6B] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]",
              !value && "text-[#6B7280]",
              className
            )}
            disabled={disabled}
          />
        }
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {value ? format(value, displayFormat, { locale: ru }) : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className={cn("w-auto p-0 bg-white border-[#E8ECF0] text-[#1B3A6B]", popoverClassName)} align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date)
            setOpen(false)
          }}
          initialFocus
          disabled={disabled}
          className="bg-white"
        />
        {allowClear && value && !disabled && (
          <div className="border-t border-[#E8ECF0] p-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full text-xs text-[#6B7280] hover:text-[#1B3A6B]"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              Очистить дату
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
