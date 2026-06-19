export type Position = {
  id: string
  name: string
  level: number
  description: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
}

export type Department = {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  head_user_id: string | null
  factory_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  created_by: string | null
  // Виртуальные поля (join)
  parent?: Department | null
  children?: Department[]
  head?: { id: string; full_name: string } | null
  factory?: { id: string; name: string } | null
  members_count?: number
}

export type DepartmentMember = {
  id: string
  user_id: string
  department_id: string
  position_id: string | null
  reports_to_user_id: string | null
  is_department_head: boolean
  joined_at: string
  created_by: string | null
  // Виртуальные поля (join)
  user?: { id: string; full_name: string; email: string; role: string; is_active: boolean }
  department?: { id: string; name: string }
  position?: { id: string; name: string; level: number } | null
  reports_to?: { id: string; full_name: string } | null
}

// Дерево отделов для UI
export type DepartmentTreeNode = Department & {
  children: DepartmentTreeNode[]
  members: DepartmentMember[]
  depth: number
}
