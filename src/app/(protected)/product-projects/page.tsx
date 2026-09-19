import { withPagePermission } from '@/lib/permissions/page-guard'
import { ProductProjectList } from '@/components/features/products/ProductProjectList'
import { getProductProjects } from '@/lib/actions/products'

export const metadata = {
  title: 'Проекты изделий — CRM Завода',
}

async function ProductProjectsPage() {
  const { data, error } = await getProductProjects()

  return error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{error}</div>
  ) : (
    <ProductProjectList projects={data || []} />
  )
}

export default withPagePermission('/product-projects', ProductProjectsPage)
