export default function Loading() {
  return (
    <div role="status" className="space-y-4" aria-label="Загружаем заявку на материалы">
      <div className="h-11 w-52 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />
      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-white motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />
    </div>
  )
}
