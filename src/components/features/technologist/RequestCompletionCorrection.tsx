'use client'
/* eslint-disable @typescript-eslint/no-explicit-any -- compact migration-backed correction view model. */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { correctTechnologistCompletion } from '@/lib/actions/request-completion'
import { calculatePlasmaTime, calculateWaste } from '@/lib/request-completion-calculations'

export function RequestCompletionCorrection({ requestId, data }: { requestId: string; data: any }) {
  const router=useRouter(); const [pending,startTransition]=useTransition(); const initial=data.completion.entered_plasma_minutes; const [hours,setHours]=useState(String(Math.floor(initial/60))); const [minutes,setMinutes]=useState(String(initial%60)); const [reason,setReason]=useState(''); const [percentages,setPercentages]=useState<Record<string,string>>(Object.fromEntries(data.wasteItems.map((item:any)=>[item.id,String(item.waste_percent)])))
  const plasma=calculatePlasmaTime(Number(hours),Number(minutes))
  function save(){startTransition(async()=>{const result=await correctTechnologistCompletion({requestId,hours:Number(hours),minutes:Number(minutes),reason,wasteItems:data.wasteItems.map((item:any)=>({wasteItemId:item.id,wastePercent:Number(percentages[item.id])}))});if(!result.success){toast.error(result.error);return}toast.success('Корректировка сохранена в истории');router.refresh()})}
  return <main className="mx-auto max-w-5xl space-y-5"><div><h1 className="text-2xl font-semibold">Корректировка завершённой заявки</h1><p className="text-muted-foreground">{data.completion.machines?.name}. Каждое изменение фиксируется с причиной.</p></div><Card><CardHeader><CardTitle>Отходность</CardTitle></CardHeader><CardContent className="space-y-3">{data.wasteItems.map((item:any)=>{const calc=calculateWaste(Number(item.weight_snapshot_kg),Number(percentages[item.id]));return <div key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_120px_140px]"><div><p className="font-medium">{item.item_name}</p><p className="text-sm text-muted-foreground">{Number(item.weight_snapshot_kg).toFixed(3)} кг</p></div><div><Label>Отход, %</Label><Input type="number" min="0" max="100" step="0.1" value={percentages[item.id]} onChange={(e)=>setPercentages({...percentages,[item.id]:e.target.value})}/></div><p className="font-mono text-sm self-end">{calc.scrapKg.toFixed(3)} кг лома</p></div>})}</CardContent></Card><Card><CardHeader><CardTitle>Время плазмы</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-4"><div><Label>Часы</Label><Input type="number" min="0" value={hours} onChange={(e)=>setHours(e.target.value)}/></div><div><Label>Минуты</Label><Input type="number" min="0" max="59" value={minutes} onChange={(e)=>setMinutes(e.target.value)}/></div><p className="self-end">+25%: {plasma.addedMinutes} мин</p><p className="self-end font-medium">Итого: {plasma.actualMinutes} мин</p></CardContent></Card><Card><CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_auto] sm:items-end"><div><Label>Причина корректировки *</Label><Input value={reason} onChange={(e)=>setReason(e.target.value)}/></div><Button disabled={pending||!reason.trim()} onClick={save}>{pending?'Сохраняем…':'Сохранить корректировку'}</Button></CardContent></Card></main>
}
