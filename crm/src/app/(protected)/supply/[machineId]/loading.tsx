import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-8 w-[250px] bg-[#F8F9FA]" />
        <Skeleton className="h-4 w-[350px] bg-[#F8F9FA]" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[120px] rounded-xl bg-[#F8F9FA]" />
        ))}
      </div>

      <Skeleton className="h-[400px] w-full rounded-xl bg-[#F8F9FA]" />
    </div>
  )
}
