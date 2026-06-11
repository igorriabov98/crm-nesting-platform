import fs from 'fs';
import path from 'path';

const routes = [
  'dashboard',
  'admin/users',
  'admin/users/new',
  'sales-plan',
  'sales-plan/[id]',
  'sales-plan/new',
  'production',
  'production/gantt',
  'supply',
  'supply/[machineId]',
  'invoices',
  'notifications'
];

const errorContent = `"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCcw } from "lucide-react"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Route Error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-slate-900 border border-slate-800 rounded-xl space-y-4 text-center">
      <AlertTriangle className="w-10 h-10 text-red-500" />
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-white">Что-то пошло не так!</h2>
        <p className="text-slate-400 text-sm">{error.message || "Ошибка загрузки модуля."}</p>
      </div>
      <Button 
        onClick={() => reset()}
        variant="outline"
        className="mt-4 border-slate-700 bg-slate-800 hover:bg-slate-700 text-white"
      >
        <RefreshCcw className="w-4 h-4 mr-2" />
        Попробовать снова
      </Button>
    </div>
  )
}
`;

const getLoadingContent = (routeName) => {
  return `import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-8 w-[250px] bg-slate-800" />
        <Skeleton className="h-4 w-[350px] bg-slate-800/50" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[120px] rounded-xl bg-slate-800" />
        ))}
      </div>

      <Skeleton className="h-[400px] w-full rounded-xl bg-slate-800/50" />
    </div>
  )
}
`;
}

for (const route of routes) {
  const dir = path.join(process.cwd(), 'src/app/(protected)', route);
  if (fs.existsSync(dir)) {
    fs.writeFileSync(path.join(dir, 'error.tsx'), errorContent);
    fs.writeFileSync(path.join(dir, 'loading.tsx'), getLoadingContent(route));
    console.log('Created error and loading for', route);
  } else {
    // If route doesn't exist, log it (we might have skipped it)
    console.log('Skipped', route);
  }
}
