import { Database } from './database'
import type { UserDepartmentMembershipSummary } from './departments'

export * from './departments'
export * from './consumables'

export type CompanySettings = Database['public']['Tables']['company_settings']['Row']
export type Factory = Database['public']['Tables']['factories']['Row']
export type User = Database['public']['Tables']['users']['Row']
export type Machine = Database['public']['Tables']['machines']['Row']
export type MachineUpdate = Database['public']['Tables']['machine_updates']['Row']
export type MachineChatMessage = Database['public']['Tables']['machine_chat_messages']['Row']
export type MachineChatMention = Database['public']['Tables']['machine_chat_mentions']['Row']
export type Client = Database['public']['Tables']['clients']['Row']
export type ClientContact = Database['public']['Tables']['client_contacts']['Row']
export type ClientProductPrice = Database['public']['Tables']['client_product_prices']['Row']
export type Contract = Database['public']['Tables']['contracts']['Row']
export type ProductionStage = Database['public']['Tables']['production_stages']['Row']
export type ProductionFactSection = Database['public']['Tables']['production_fact_sections']['Row']
export type Employee = Database['public']['Tables']['employees']['Row']
export type EmployeeRate = Database['public']['Tables']['employee_rates']['Row']
export type EmployeeVacation = Database['public']['Tables']['employee_vacations']['Row']
export type EmployeeAssignment = Database['public']['Tables']['employee_assignments']['Row']
export type ProductionMachineFact = Database['public']['Tables']['production_machine_facts']['Row']
export type ProductionTonnageFact = Database['public']['Tables']['production_tonnage_facts']['Row']
export type ProductionMonthPlan = Database['public']['Tables']['production_month_plans']['Row']
export type ProductionPlanDateChangeRequest = Database['public']['Tables']['production_plan_date_change_requests']['Row']
export type ProductionPlanDateChangeRequestItem = Database['public']['Tables']['production_plan_date_change_request_items']['Row']
export type OutsourcingWorkType = Database['public']['Tables']['outsourcing_work_types']['Row']
export type FactoryZincOutsourcingDefault = Database['public']['Tables']['factory_zinc_outsourcing_defaults']['Row']
export type MachineOutsourcingOperation = Database['public']['Tables']['machine_outsourcing_operations']['Row']
export type MachineOutsourcingOperationItem = Database['public']['Tables']['machine_outsourcing_operation_items']['Row']
export type MachineOutsourcingTransportNeed = Database['public']['Tables']['machine_outsourcing_transport_needs']['Row']
export type MachineOutsourcingTransportOrder = Database['public']['Tables']['machine_outsourcing_transport_orders']['Row']
export type SupplyItem = Database['public']['Tables']['supply_items']['Row']
export type Invoice = Database['public']['Tables']['invoices']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type MachineItem = Database['public']['Tables']['machine_items']['Row']
export type MachineItemNestingRun = Database['public']['Tables']['machine_item_nesting_runs']['Row']
export type MachineExpense = Database['public']['Tables']['machine_expenses']['Row']
export type MachinePackingGroup = Database['public']['Tables']['machine_packing_groups']['Row']
export type Product = Database['public']['Tables']['products']['Row']
export type ProductFile = Database['public']['Tables']['product_files']['Row']
export type ProductProject = Database['public']['Tables']['product_projects']['Row']
export type ProductProjectVersion = Database['public']['Tables']['product_project_versions']['Row']
export type ProductProjectFile = Database['public']['Tables']['product_project_files']['Row']
export type Supplier = Database['public']['Tables']['suppliers']['Row']
export type Material = Database['public']['Tables']['materials']['Row']
export type MaterialVariant = Database['public']['Tables']['material_variants']['Row']
export type Inventory = Database['public']['Tables']['inventory']['Row']
export type InventoryTransaction = Database['public']['Tables']['inventory_transactions']['Row']
export type InventoryReservation = Database['public']['Tables']['inventory_reservations']['Row']
export type SupplierDeliveryDay = Database['public']['Tables']['supplier_delivery_days']['Row']
export type SupplierMaterialCategory = Database['public']['Tables']['supplier_material_categories']['Row']
export type TaskDelegation = Database['public']['Tables']['task_delegations']['Row']
export type Task = Database['public']['Tables']['tasks']['Row']
export type TechnologistRequest = Database['public']['Tables']['technologist_requests']['Row']
export type MachineLayoutRequest = Database['public']['Tables']['machine_layout_requests']['Row']
export type RequestSheetMetal = Database['public']['Tables']['request_sheet_metal']['Row']
export type RequestRoundTube = Database['public']['Tables']['request_round_tube']['Row']
export type RequestCircle = Database['public']['Tables']['request_circle']['Row']
export type RequestPipe = Database['public']['Tables']['request_pipe']['Row']
export type RequestKnives = Database['public']['Tables']['request_knives']['Row']
export type RequestComponents = Database['public']['Tables']['request_components']['Row']
export type RequestPaint = Database['public']['Tables']['request_paint']['Row']
export type RequestMesh = Database['public']['Tables']['request_mesh']['Row']
export type RequestChainCord = Database['public']['Tables']['request_chain_cord']['Row']
export type RolePermission = Database['public']['Tables']['role_permissions']['Row']
export type RolePermissionAuditLog = Database['public']['Tables']['role_permission_audit_log']['Row']

export type MachineWithTotals = Database['public']['Views']['machines_with_totals']['Row']
export type SupplyItemWithOverdue = Database['public']['Views']['supply_items_with_overdue']['Row']
export type ProductionStageWithDelay = Database['public']['Views']['production_stages_with_delay']['Row']

export type UserRole = Database['public']['Enums']['user_role']
export type CoatingType = Database['public']['Enums']['coating_type']
export type StageType = Database['public']['Enums']['stage_type']
export type SupplyStatus = Database['public']['Enums']['supply_status']
export type InvoiceStatus = Database['public']['Enums']['invoice_status']
export type MachineStatus = Database['public']['Enums']['machine_status']
export type PaymentTermsType = Database['public']['Enums']['payment_terms_type']
export type ProductionFactShift = Database['public']['Enums']['production_fact_shift']
export type EmployeeAssignmentStatus = Database['public']['Enums']['employee_assignment_status']
export type MaterialType = Database['public']['Enums']['material_type']
export type MeetingType = string
export type MeetingStatus = Database['public']['Enums']['meeting_status']
export type MaterialCategory = Database['public']['Enums']['material_category']
export type PipeSubtype = Database['public']['Enums']['pipe_subtype']
export type ChainCordSubtype = Database['public']['Enums']['chain_cord_subtype']
export type TaskDelegationStatus = Database['public']['Enums']['task_delegation_status']
export type TaskType = Database['public']['Enums']['task_type']
export type TaskStatus = Database['public']['Enums']['task_status']
export type ProductionMonthPlanStatus = Database['public']['Enums']['production_month_plan_status']
export type ProductionDateChangeRequestStatus = Database['public']['Enums']['production_date_change_request_status']
export type OutsourcingExecutorType = Database['public']['Enums']['outsourcing_executor_type']
export type OutsourcingTransportDirection = Database['public']['Enums']['outsourcing_transport_direction']
export type OutsourcingTransportPlanState = Database['public']['Enums']['outsourcing_transport_plan_state']
export type OutsourcingTransportNeedStatus = Database['public']['Enums']['outsourcing_transport_need_status']
export type OutsourcingTransportOrderStatus = Database['public']['Enums']['outsourcing_transport_order_status']
export type RequestStatus = Database['public']['Enums']['request_status']
export type OrderItemStatus = Database['public']['Enums']['order_item_status']
export type InventoryTransactionType = Database['public']['Enums']['inventory_transaction_type']

export type MachineProgressKey =
  | 'created'
  | 'decoded'
  | 'planned'
  | 'waiting_request'
  | 'purchasing'
  | 'material_received'
  | `production:${string}`
  | 'shipped'

export type MachineProgressStepState = 'done' | 'active' | 'pending' | 'blocked'
export type MachineProgressStepKind = 'milestone' | 'check' | 'production'

export type MachineProgressStep = {
  key: MachineProgressKey
  label: string
  state: MachineProgressStepState
  kind: MachineProgressStepKind
  blocker?: string | null
}

export type MachineProgress = {
  currentKey: MachineProgressKey
  currentLabel: string
  steps: MachineProgressStep[]
  blockers: string[]
}

export type CurrentUser = User & {
  factory: Factory
  department_memberships?: UserDepartmentMembershipSummary[]
}

export type UserSummary = Pick<User, 'id' | 'full_name' | 'role' | 'factory_id'>
export type FactorySummary = Pick<Factory, 'id' | 'name'>

export type MachineWithStages = Machine & {
  production_stages: ProductionStage[]
}

export type InvoiceWithMachine = Invoice & {
  machines: Pick<Machine, 'name' | 'created_by' | 'factory_id' | 'client_id'>
  client?: Pick<Client, 'id' | 'name'> | null
}

export type ClientSummary = Pick<Client,
  | 'id'
  | 'name'
  | 'primary_contact_name'
  | 'phone'
  | 'email'
  | 'country_city'
  | 'payment_terms_type'
  | 'payment_due_days'
  | 'prepayment_percent'
  | 'final_payment_due_days'
>

export type MachineRelation = Pick<Machine,
  | 'id'
  | 'name'
  | 'status'
  | 'factory_id'
  | 'material_type'
  | 'desired_shipping_date'
  | 'planned_material_date'
  | 'production_month'
  | 'production_workshop'
  | 'production_queue_number'
> & {
  machine_items?: (Pick<MachineItem, 'id' | 'product_id' | 'drawing_number' | 'product_name' | 'product_name_uk' | 'product_name_en' | 'product_uktzed' | 'product_drawing_number' | 'price' | 'quantity' | 'weight' | 'coating' | 'ral_number' | 'is_sample'> & {
    sort_order?: number | null
  })[]
  total_weight?: number
  total_cost?: number
  item_count?: number
}

export type MachineDetails = Machine & {
  machine_items: MachineItem[]
  machine_expenses: MachineExpense[]
  machine_packing_groups?: MachinePackingGroup[]
  production_stages: ProductionStage[]
  supply_items: SupplyItem[]
  invoice: Invoice | Invoice[] | null
  created_by_user?: Pick<User, 'full_name'> | null
  factory?: Pick<Factory, 'name'> | null
  client?: Pick<Client, 'id' | 'name' | 'primary_contact_name' | 'phone' | 'email' | 'country_city'> | null
  total_weight: number
  total_items_cost: number
  total_expenses: number
  total_cost: number
  item_count: number
  has_zinc: boolean
  has_painting: boolean
  progress: MachineProgress
}

export type MachineListItem = MachineWithTotals & {
  factory?: Pick<Factory, 'name'> | null
  created_by_user?: Pick<User, 'full_name'> | null
  client?: Pick<Client, 'id' | 'name' | 'primary_contact_name'> | null
  product?: string | null
  machine_items?: Pick<MachineItem, 'id' | 'product_id' | 'product_project_id' | 'product_project_version_id' | 'drawing_number' | 'product_name' | 'product_name_uk' | 'product_name_en' | 'product_uktzed' | 'product_drawing_number' | 'weight' | 'price' | 'quantity' | 'coating' | 'ral_number' | 'is_sample'>[]
  production_stages?: Pick<ProductionStage, 'stage_type' | 'date_start' | 'date_end' | 'is_skipped'>[]
  supply_items?: Pick<SupplyItem, 'id' | 'status'>[]
  invoice?: Pick<Invoice, 'status' | 'payment_date' | 'due_date' | 'amount' | 'paid_amount'> | Pick<Invoice, 'status' | 'payment_date' | 'due_date' | 'amount' | 'paid_amount'>[] | null
  production_progress: { completed: number; total: number }
  supply_progress: { completed: number; total: number }
  uniqueCoatings: CoatingType[]
  progress: MachineProgress
}

export type Meeting = {
  id: string
  meeting_type: MeetingType
  title: string | null
  meeting_date: string
  meeting_time: string
  duration_minutes: number
  status: MeetingStatus
  notes?: string | null
  recurrence_rule_id?: string | null
  recurrence_occurrence_date?: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

export type MeetingAttendee = {
  id: string
  meeting_id?: string
  user_id?: string
  is_confirmed?: boolean
  attended?: boolean
  user?: UserSummary | null
}

export type MeetingExternalAttendee = {
  id: string
  meeting_id?: string
  full_name: string
  role_description?: string | null
  phone?: string | null
  email?: string | null
}

export type MeetingAgendaItem = {
  id: string
  meeting_id?: string
  title: string
  description?: string | null
  machine_id?: string | null
  auto_generated?: boolean
  source_key?: string | null
  source_type?: string | null
  resolved_at?: string | null
  resolved_by?: string | null
  resolved_decision_id?: string | null
  carried_from_item_id?: string | null
  sort_order: number
  machine?: MachineRelation | null
}

export type MeetingDecision = {
  id: string
  meeting_id?: string
  machine_id?: string | null
  assigned_factory_id?: string | null
  assigned_material_type?: MaterialType | null
  decision_text: string
  responsible_user_id?: string | null
  deadline?: string | null
  machine?: Pick<Machine, 'id' | 'name'> | null
  assigned_factory?: Pick<Factory, 'name'> | null
  responsible?: Pick<User, 'full_name'> | null
}

export type MeetingActionItem = {
  id: string
  meeting_id?: string
  title?: string | null
  description?: string | null
  responsible_user_id?: string | null
  deadline?: string | null
  status: 'open' | 'done'
  related_task_id?: string | null
  responsible?: Pick<User, 'full_name'> | null
}

export type MeetingListItem = Meeting & {
  agenda?: Pick<MeetingAgendaItem, 'id'>[]
  attendees?: Pick<MeetingAttendee, 'id'>[]
  decisions?: Pick<MeetingDecision, 'id'>[]
  agenda_items_count: number
  attendees_count: number
  decisions_count: number
}

export type MeetingDetails = Meeting & {
  created_by_user?: Pick<User, 'full_name'> | null
  attendees: MeetingAttendee[]
  external_attendees: MeetingExternalAttendee[]
  agenda: MeetingAgendaItem[]
  decisions: MeetingDecision[]
  action_items: MeetingActionItem[]
}

export type UpcomingMeeting = Pick<Meeting, 'id' | 'meeting_type' | 'meeting_date' | 'meeting_time' | 'title'> & {
  agenda?: Pick<MeetingAgendaItem, 'id'>[]
  attendees?: Pick<MeetingAttendee, 'id'>[]
  agenda_items_count: number
  attendees_count: number
}
