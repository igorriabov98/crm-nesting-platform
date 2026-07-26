export function formatCompanyLocation(company: {
  name: string
  city?: string | null
  address?: string | null
}) {
  return [company.city?.trim(), company.address?.trim()].filter(Boolean).join(', ') || company.name
}
