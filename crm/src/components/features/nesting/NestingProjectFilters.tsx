'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const statusOptions = [
  { value: 'all', label: 'Все статусы' },
  { value: 'parsing', label: 'Парсинг' },
  { value: 'parsed', label: 'Готово к расчёту' },
  { value: 'calculating', label: 'Расчёт' },
  { value: 'done', label: 'Готово' },
  { value: 'error', label: 'Ошибка' },
]

export function NestingProjectFilters({
  search,
  status,
}: {
  search: string
  status: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(search)

  const pushParams = useCallback((params: URLSearchParams) => {
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router])

  const setParam = useCallback((name: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') {
      params.delete(name)
    } else {
      params.set(name, value)
    }
    params.delete('page')
    pushParams(params)
  }, [pushParams, searchParams])

  useEffect(() => {
    setSearchValue(search)
  }, [search])

  useEffect(() => {
    const nextSearch = searchValue.trim()
    if (nextSearch === search) return

    const timer = window.setTimeout(() => {
      setParam('search', nextSearch)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [search, searchValue, setParam])

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <form
        className="relative w-full md:max-w-sm"
        onSubmit={(event) => {
          event.preventDefault()
          setParam('search', searchValue.trim())
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
        <Input
          name="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Поиск по заказу..."
          className="bg-white pl-9"
        />
      </form>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status || 'all'} onValueChange={(value) => setParam('status', value || 'all')}>
          <SelectTrigger className="w-full bg-white sm:w-[210px]">
            <SelectValue>{statusOptions.find((option) => option.value === (status || 'all'))?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-white">
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link href="/nesting/new">
          <Button>Новая раскладка</Button>
        </Link>
      </div>
    </div>
  )
}
