export function approvalBadgeClass(state: string | null | undefined) {
  if (state === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (state === 'returned') return 'border-red-200 bg-red-50 text-red-800'
  if (state === 'pending') return 'border-violet-200 bg-violet-50 text-violet-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}
