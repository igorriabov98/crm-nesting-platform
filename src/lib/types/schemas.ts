import { z } from 'zod'

const roles = [
  'financial_director',
  'commercial_director',
  'planning_director',
  'sales_manager',
  'engineer',
  'technologist',
  'supply_manager',
  'production_manager',
  'procurement_head',
  'painting_head',
]

export const createUserSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(12, 'Пароль должен содержать минимум 12 символов'),
  full_name: z.string().min(2, 'Имя должно содержать минимум 2 символа'),
  role: z.string().refine((val) => roles.includes(val), {
    message: 'Выберите допустимую роль'
  }),
  factory_id: z.string().uuid('Выберите завод').optional().nullable(),
  telegram_chat_id: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.role === 'production_manager' && !data.factory_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['factory_id'],
      message: 'Для начальника производства нужно выбрать завод',
    })
  }
})

export const updateUserSchema = z.object({
  full_name: z.string().min(2, 'Имя должно содержать минимум 2 символа').optional(),
  role: z.string().refine((val) => roles.includes(val)).optional(),
  factory_id: z.string().uuid('Выберите завод').optional().nullable(),
  is_active: z.boolean().optional(),
  telegram_chat_id: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.role === 'production_manager' && !data.factory_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['factory_id'],
      message: 'Для начальника производства нужно выбрать завод',
    })
  }
})

// Схема одного товара
export const machineItemSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional().nullable(),
  product_name_uk: z.string().optional().nullable(),
  product_name_en: z.string().optional().nullable(),
  product_uktzed: z.string().optional().nullable(),
  product_drawing_number: z.string().optional().nullable(),
  product_characteristics: z.string().optional().nullable(),
  drawing_number: z.string().min(1, 'Введите номер чертежа'),
  product_name: z.string().min(1, 'Введите название товара'),
  weight: z.number().positive('Вес должен быть больше 0'),
  net_weight: z.coerce.number().min(0, 'Нетто вес не может быть отрицательным').optional().nullable(),
  price: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().int().positive('Количество должно быть больше 0'),
  packing_type: z.string().optional().nullable(),
  packing_places: z.coerce.number().int().min(0, 'Кол-во мест не может быть отрицательным').optional().nullable(),
  coating: z.enum(['zinc', 'powder_coating', 'none']),
  ral_number: z.string().optional(),
  is_sample: z.boolean().optional(),
})

// Схема доп. расхода
export const machineExpenseSchema = z.object({
  id: z.string().uuid().optional(),
  category: z.string().min(1, 'Введите категорию'),
  amount: z.number().min(0, 'Сумма не может быть отрицательной'),
  comment: z.string().optional(),
})

export const machinePackingGroupSchema = z.object({
  id: z.string().uuid().optional(),
  start_item_number: z.coerce.number().int().min(1),
  end_item_number: z.coerce.number().int().min(1),
  packing_type_en: z.string().trim().min(1),
  packing_type_ua: z.string().trim().optional().nullable(),
  places: z.coerce.number().int().min(1),
}).refine((group) => group.end_item_number >= group.start_item_number, {
  message: 'Конечный номер не может быть меньше начального',
  path: ['end_item_number'],
})

export const machinePackingSettingsSchema = z.object({
  groups: z.array(machinePackingGroupSchema).default([]),
})

export const productStatusSchema = z.enum(['draft', 'active', 'archived'])
export const productFileKindSchema = z.enum(['drawing', 'step', 'pdf', 'photo', 'other'])
export const productProjectStatusSchema = z.enum(['draft', 'engineering', 'client_review', 'approved', 'added_to_products', 'cancelled'])
export const productProjectVersionStatusSchema = z.enum(['draft', 'client_review', 'approved', 'superseded'])

export const productSchema = z.object({
  name_uk: z.string().min(1, 'Введіть назву українською'),
  name_en: z.string().min(1, 'Enter English name'),
  uktzed: z.string().min(1, 'Введите УКТЗЕД'),
  drawing_number: z.string().min(1, 'Введите номер чертежа'),
  characteristics: z.string().optional().default(''),
  unit_weight_kg: z.coerce.number().positive('Вес должен быть больше 0'),
  base_price_eur: z.coerce.number().min(0, 'Цена не может быть отрицательной').default(0),
  status: productStatusSchema.default('draft'),
})

export const productProjectSchema = z.object({
  title: z.string().min(1, 'Введите название проекта'),
  client_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().default(''),
  characteristics: z.string().optional().default(''),
  client_wishes: z.string().optional().default(''),
  assigned_engineer_id: z.string().uuid('Выберите инженера'),
  status: productProjectStatusSchema.default('draft'),
})

export const productProjectVersionSchema = z.object({
  version_label: z.string().optional().nullable(),
  description: z.string().optional().default(''),
  characteristics: z.string().optional().default(''),
  client_wishes: z.string().optional().default(''),
  status: productProjectVersionStatusSchema.default('draft'),
})

export const companySettingsSchema = z.object({
  name_en: z.string().optional().default(''),
  name_ua: z.string().optional().default(''),
  address_en: z.string().optional().default(''),
  address_ua: z.string().optional().default(''),
  director_name_en: z.string().optional().default(''),
  director_name_ua: z.string().optional().default(''),
  enterprise_code: z.string().optional().default(''),
  iban: z.string().optional().default(''),
  swift: z.string().optional().default(''),
  bank_name: z.string().optional().default(''),
  bank_address: z.string().optional().default(''),
  delivery_basis_en: z.string().optional().default('Delivery Basis: DAP'),
  delivery_basis_ua: z.string().optional().default('Базис постачання: DAP'),
  intermediary_bank_name: z.string().optional().default(''),
  intermediary_bank_swift: z.string().optional().default(''),
  signature_image_path: z.string().optional().nullable(),
  stamp_image_path: z.string().optional().nullable(),
})

export const promoteProductVersionSchema = z.object({
  name_uk: z.string().min(1, 'Введіть назву українською'),
  name_en: z.string().min(1, 'Enter English name'),
  uktzed: z.string().min(1, 'Введите УКТЗЕД'),
  drawing_number: z.string().min(1, 'Введите номер чертежа'),
  unit_weight_kg: z.coerce.number().positive('Вес должен быть больше 0'),
  base_price_eur: z.coerce.number().min(0, 'Цена не может быть отрицательной').default(0),
  status: productStatusSchema.default('active'),
})

export const paymentTermsTypeSchema = z.enum(['invoice_days', 'delivery_days', 'prepayment_full'])

export const clientSchema = z.object({
  name: z.string().min(1, 'Введите название клиента'),
  primary_contact_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')).nullable(),
  country_city: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  delivery_address: z.string().optional().nullable(),
  delivery_basis_location_en: z.string().optional().nullable(),
  delivery_basis_location_ua: z.string().optional().nullable(),
  director_name: z.string().optional().nullable(),
  second_director_name: z.string().optional().nullable(),
  second_director_name_en: z.string().optional().nullable(),
  second_director_name_ua: z.string().optional().nullable(),
  vat_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payment_terms_type: paymentTermsTypeSchema.default('invoice_days'),
  payment_due_days: z.coerce.number().int().min(0, 'Срок оплаты не может быть отрицательным').default(14),
  prepayment_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  final_payment_due_days: z.coerce.number().int().min(0).optional().nullable(),
})

export const clientContactSchema = z.object({
  full_name: z.string().min(1, 'Введите имя контактного лица'),
  phone: z.string().optional().nullable(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')).nullable(),
  role_description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// Обновлённая схема создания машины
export const createMachineSchema = z.object({
  name: z.string().min(1, 'Введите название машины'),
  client_id: z.string().uuid('Выберите клиента'),
  contract_id: z.string().uuid().optional().nullable(),
  specification_number: z.string().optional().nullable(),
  specification_date: z.string().optional().nullable(),
  is_confirmed: z.boolean().default(false),
  material_type: z.enum(['standard', 'non_standard', 'undefined']).optional()
    .default('undefined'),
  desired_shipping_date: z.string().optional().nullable(),
  planned_material_date: z.string().optional().nullable(),
  actual_material_date: z.string().optional().nullable(),
  actual_shipping_date: z.string().optional().nullable(),
  delivery_to_client_date: z.string().optional().nullable(),
  items: z.array(machineItemSchema).optional().default([]),
  samples: z.array(machineItemSchema).optional().default([]),
  expenses: z.array(machineExpenseSchema).optional(),
  factory_id: z.string().uuid('Выберите завод').optional().nullable(),
  production_month: z.string().optional().nullable(),
  production_workshop: z.coerce.number().int().min(1, 'Выберите цех').max(2, 'Выберите цех').optional().nullable(),
  production_queue_number: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum([
    'created',
    'under_review',
    'factory_assigned',
    'in_production',
    'shipped',
    'confirmed',
    'planned',
    'request_ready',
    'purchasing',
    'material_received',
  ]).optional()
})

export const updateMachineSchema = createMachineSchema.partial()

export type CreateMachineInput = z.infer<typeof createMachineSchema>
export type UpdateMachineInput = z.infer<typeof updateMachineSchema>
export type ClientInput = z.infer<typeof clientSchema>
export type ClientContactInput = z.infer<typeof clientContactSchema>
export type ProductInput = z.infer<typeof productSchema>
export type ProductProjectInput = z.infer<typeof productProjectSchema>
export type ProductProjectVersionInput = z.infer<typeof productProjectVersionSchema>
export type PromoteProductVersionInput = z.infer<typeof promoteProductVersionSchema>
export type UpdateCompanySettingsData = z.input<typeof companySettingsSchema>
export type MachinePackingSettingsInput = z.input<typeof machinePackingSettingsSchema>

export const resetPasswordSchema = z.object({
  password: z.string().min(12, 'Пароль должен содержать минимум 12 символов'),
  confirmPassword: z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  { message: 'Пароли не совпадают', path: ['confirmPassword'] }
)

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>

// === МУДУЛЬ СОБРАНИЙ ===

export const createMeetingSchema = z.object({
  meeting_type: z.string().min(1, 'Выберите тип собрания').regex(/^[a-z0-9_]+$/, 'Некорректный тип собрания'),
  title: z.string().optional(),
  meeting_date: z.string().min(1, 'Выберите дату'),
  meeting_time: z.string().min(1, 'Выберите время'),
  duration_minutes: z.coerce.number().int().min(15).max(240).refine((value) => value % 15 === 0, {
    message: 'Длительность должна идти с шагом 15 минут',
  }).default(60),
  is_recurring: z.boolean().optional(),
  recurrence_weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  recurrence_end_date: z.string().optional(),
  recurrence_count: z.coerce.number().int().min(1).max(104).optional(),
})

export const updateMeetingSchema = z.object({
  meeting_date: z.string().optional(),
  meeting_time: z.string().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240).refine((value) => value % 15 === 0).optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional(),
  notes: z.string().optional(),
  title: z.string().optional(),
})

export const addAgendaItemSchema = z.object({
  title: z.string().min(1, 'Введите заголовок'),
  description: z.string().optional(),
  machine_id: z.string().uuid().optional(),
})

export const addDecisionSchema = z.object({
  decision_text: z.string().min(1, 'Введите текст решения'),
  machine_id: z.string().uuid().optional(),
  assigned_factory_id: z.string().uuid().optional(),
  assigned_material_type: z.enum(['standard', 'non_standard', 'undefined']).optional(),
  responsible_user_id: z.string().uuid().optional(),
  deadline: z.string().optional(),
})

export const addActionItemSchema = z.object({
  title: z.string().min(1, 'Введите название задачи'),
  description: z.string().optional(),
  responsible_user_id: z.string().uuid('Выберите ответственного'),
  deadline: z.string().min(1, 'Выберите дедлайн'),
})

export const addExternalAttendeeSchema = z.object({
  full_name: z.string().min(1, 'Введите имя'),
  role_description: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')),
})

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>
export type AddDecisionInput = z.infer<typeof addDecisionSchema>
export type AddActionItemInput = z.infer<typeof addActionItemSchema>
export type AddAgendaItemInput = z.infer<typeof addAgendaItemSchema>
export type AddExternalAttendeeInput = z.infer<typeof addExternalAttendeeSchema>
