export function addInvoiceDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const nextYear = date.getFullYear()
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

export function calculateInvoiceDueDate(machine: {
  payment_terms_type?: string | null
  payment_due_days?: number | null
  final_payment_due_days?: number | null
  delivery_to_client_date?: string | null
}, invoiceDate: string) {
  const fallbackDays = Number(machine.payment_due_days || 0)
  const deliveryDate = machine.delivery_to_client_date || null

  if (machine.payment_terms_type === 'delivery_days' && deliveryDate) {
    return addInvoiceDays(deliveryDate, fallbackDays)
  }

  if (machine.payment_terms_type === 'prepayment_full' && deliveryDate) {
    return addInvoiceDays(deliveryDate, Number(machine.final_payment_due_days || fallbackDays))
  }

  return addInvoiceDays(invoiceDate, fallbackDays)
}

export function calculateInvoiceAmount(
  items: readonly { price: number | null; quantity: number | null }[],
  expenses: readonly { amount: number | null }[],
) {
  const totalItems = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  )
  const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  return totalItems + totalExpenses
}
