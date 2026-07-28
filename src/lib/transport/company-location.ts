export function formatCompanyLocation(company: {
  name: string
  city?: string | null
  address?: string | null
}) {
  const location = [company.city?.trim(), company.address?.trim()].filter(Boolean).join(', ')
  return location ? `${company.name} — ${location}` : company.name
}
