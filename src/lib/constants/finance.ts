export const SUPPLY_FINANCE_CATEGORIES = ['Метал Украина', 'Метал Импорт', 'Прочие расходы'] as const
export const GENERAL_FINANCE_EXPENSE_CATEGORIES = ['ЗП', 'Аренда', 'Налоги и Кредиты', 'Электричество', 'Прочие Админ. расходы', 'Транспорт'] as const

export type SupplyFinanceCategory = typeof SUPPLY_FINANCE_CATEGORIES[number]
export type GeneralFinanceExpenseCategory = typeof GENERAL_FINANCE_EXPENSE_CATEGORIES[number]
