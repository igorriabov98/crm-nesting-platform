"use client"

import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NIGHT_SHIFT_COLOR, STAGE_ORDER, stageHasSingleDate } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import {
  GANTT_BAR_HEIGHT,
  GANTT_MARKER_SIZE,
  GANTT_SHIPPING_MARKER_HEIGHT,
  GANTT_STAGE_DOT_SIZE,
  getGanttStageColor,
  getGanttStageLabel,
} from './types'
import type { StageType } from '@/lib/types'

export function GanttLegend({
  defaultOpen = false,
  stages = STAGE_ORDER,
}: {
  defaultOpen?: boolean
  stages?: StageType[]
}) {
  const [open, setOpen] = useState(defaultOpen)
  const planOnly = !stages.includes('actual_shipping')

  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-white text-xs shadow-sm">
      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-sm font-semibold text-[#1B3A6B] transition-colors hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Легенда</span>
        <ChevronDown className={cn("h-4 w-4 text-[#6B7280] transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="grid gap-4 border-t border-[#E8ECF0] p-3 sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <p className="mb-2 font-medium uppercase text-[#6B7280]">Этапы</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {stages.map((stage) => (
              <div key={stage} className="flex items-center gap-1.5">
                <div
                  className={cn("shrink-0", stageHasSingleDate(stage) ? "rounded-full" : "rounded-sm")}
                  style={{
                    width: GANTT_STAGE_DOT_SIZE,
                    height: GANTT_STAGE_DOT_SIZE,
                    backgroundColor: getGanttStageColor(stage),
                  }}
                />
                <span className="text-[#374151]">{getGanttStageLabel(stage)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium uppercase text-[#6B7280]">Бар этапа</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div
                className="w-9 rounded-sm border-2 border-dashed border-[#4472C4] bg-[#4472C4]/15"
                style={{ height: GANTT_BAR_HEIGHT }}
              />
              <span className="text-[#374151]">Плановый этап</span>
            </div>
            {!planOnly && (
              <>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-9 rounded-sm bg-[#4472C4] shadow-sm"
                    style={{ height: GANTT_BAR_HEIGHT }}
                  />
                  <span className="text-[#374151]">Факт / в работе</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-9 rounded-sm bg-[#4472C4] shadow-sm ring-2 ring-red-500"
                    style={{ height: GANTT_BAR_HEIGHT }}
                  />
                  <span className="text-[#374151]">Просрочено</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5">
              <div
                className="relative w-9 overflow-hidden rounded-sm border-2 border-dashed border-[#70AD47] bg-[#70AD47]/15 shadow-sm"
                style={{ height: GANTT_BAR_HEIGHT }}
              >
                <div className="absolute inset-y-0 left-2 w-1.5 opacity-80" style={{ backgroundColor: NIGHT_SHIFT_COLOR }} />
                <div className="absolute inset-y-0 left-5 w-1.5 opacity-80" style={{ backgroundColor: NIGHT_SHIFT_COLOR }} />
              </div>
              <span className="text-[#374151]">Ночная малярка</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-9 rounded-sm bg-[#4472C4] bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.35)_4px,rgba(255,255,255,0.35)_8px)] shadow-sm"
                style={{ height: GANTT_BAR_HEIGHT }}
              />
              <span className="text-[#374151]">Машина не подтверждена</span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium uppercase text-[#6B7280]">Снабжение</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-sm bg-[#70AD47] shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                style={{ width: GANTT_MARKER_SIZE, height: GANTT_MARKER_SIZE }}
              />
              <span className="text-[#374151]">Получено</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-sm bg-[#FFC000] shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                style={{ width: GANTT_MARKER_SIZE, height: GANTT_MARKER_SIZE }}
              />
              <span className="text-[#374151]">Заказано</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-sm bg-[#DC2626] shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                style={{ width: GANTT_MARKER_SIZE, height: GANTT_MARKER_SIZE }}
              />
              <span className="text-[#374151]">Просрочено</span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium uppercase text-[#6B7280]">Даты машины</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div
                className="rotate-45 border-2 border-[#16A34A] bg-white shadow-[0_1px_2px_rgba(22,163,74,0.25)]"
                style={{ width: GANTT_MARKER_SIZE, height: GANTT_MARKER_SIZE }}
              />
              <span className="text-[#374151]">План. поставка материала</span>
            </div>
            {!planOnly && (
              <>
                <div className="flex items-center gap-1.5">
                  <div
                    className="rotate-45 bg-[#16A34A] shadow-[0_1px_2px_rgba(22,163,74,0.25)]"
                    style={{ width: GANTT_MARKER_SIZE, height: GANTT_MARKER_SIZE }}
                  />
                  <span className="text-[#374151]">Факт. поставка материала</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-0 w-0 border-l-transparent border-r-transparent border-t-[#DC2626] drop-shadow-sm"
                    style={{
                      borderLeftWidth: GANTT_MARKER_SIZE / 2,
                      borderRightWidth: GANTT_MARKER_SIZE / 2,
                      borderTopWidth: GANTT_SHIPPING_MARKER_HEIGHT,
                    }}
                  />
                  <span className="text-[#374151]">Факт. отгрузка с завода</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5">
              <div className="h-4 border-l-2 border-dashed border-[#DC2626]" />
              <span className="text-[#374151]">Желаемая дата отгрузки</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative h-5 w-9 rounded-sm bg-red-100">
                <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-500" />
              </div>
              <span className="text-[#374151]">Сегодня</span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium uppercase text-[#6B7280]">Нагрузка сварки</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="flex h-6 w-10 items-center justify-center border border-[#E8ECF0] bg-white text-[10px] font-semibold text-[#1B3A6B]">
                0.90
              </div>
              <span className="text-[#374151]">Тоннаж по цеху за день</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-6 w-10 border border-[#E8ECF0] bg-red-50" />
              <span className="text-[#374151]">Сегодня</span>
            </div>
          </div>
        </div>
      </div>}
    </div>
  )
}
