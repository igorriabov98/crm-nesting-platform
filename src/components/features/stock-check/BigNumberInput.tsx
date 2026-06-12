'use client'

type BigNumberInputProps = {
  value: string | number
  onChange: (value: string) => void
  disabled?: boolean
  step?: string
  placeholder?: string
}

export function BigNumberInput({ value, onChange, disabled, step = '1', placeholder = '0' }: BigNumberInputProps) {
  return (
    <input
      type="number"
      inputMode="numeric"
      step={step}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 text-lg font-medium text-slate-900 shadow-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/20 disabled:bg-slate-100 disabled:text-slate-500"
    />
  )
}
