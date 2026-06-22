import type {
  Department,
  DepartmentMember,
  DepartmentTreeNode,
} from '@/lib/types/departments'

/**
 * Построить дерево из плоского массива отделов.
 * Корневые — те, у кого parent_id = null.
 * Каждый узел получает depth (глубину) и массив children.
 */
export function buildDepartmentTree(
  departments: Department[],
  members: DepartmentMember[] = []
): DepartmentTreeNode[] {
  const membersByDepartment = groupMembersByDepartment(members)
  const departmentsByParent = new Map<string | null, Department[]>()

  for (const department of departments) {
    const siblings = departmentsByParent.get(department.parent_id) || []
    siblings.push(department)
    departmentsByParent.set(department.parent_id, siblings)
  }

  function buildNodes(
    parentId: string | null,
    depth: number,
    visited: Set<string>
  ): DepartmentTreeNode[] {
    const nodes: DepartmentTreeNode[] = []

    for (const department of departmentsByParent.get(parentId) || []) {
      if (visited.has(department.id)) continue

      const nextVisited = new Set(visited)
      nextVisited.add(department.id)

      nodes.push({
        ...department,
        children: buildNodes(department.id, depth + 1, nextVisited),
        members: [...(membersByDepartment.get(department.id) || [])],
        depth,
      })
    }

    return nodes
  }

  return buildNodes(null, 0, new Set<string>())
}

/**
 * Найти все ID дочерних отделов рекурсивно (включая внуков и глубже).
 * Полезно для фильтрации: «покажи всех сотрудников отдела и его подотделов».
 */
export function getAllChildDepartmentIds(
  tree: DepartmentTreeNode[],
  parentId: string
): string[] {
  const searchVisited = new Set<string>()

  function findNode(nodes: DepartmentTreeNode[]): DepartmentTreeNode | null {
    for (const node of nodes) {
      if (searchVisited.has(node.id)) continue
      searchVisited.add(node.id)

      if (node.id === parentId) return node

      const found = findNode(node.children)
      if (found) return found
    }

    return null
  }

  const parent = findNode(tree)
  if (!parent) return []

  const childIds: string[] = []
  const visited = new Set<string>([parentId])

  function collectChildIds(nodes: DepartmentTreeNode[]) {
    for (const node of nodes) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      childIds.push(node.id)
      collectChildIds(node.children)
    }
  }

  collectChildIds(parent.children)
  return childIds
}

/**
 * Построить цепочку хлебных крошек от корня до выбранного отдела.
 * Пример: «Компания → Производство → Цех №1».
 * Используется в UI для навигации.
 */
export function getDepartmentBreadcrumbs(
  departments: Department[],
  departmentId: string
): Department[] {
  const departmentsById = new Map(
    departments.map((department) => [department.id, department])
  )
  const breadcrumbs: Department[] = []
  const visited = new Set<string>()
  let current = departmentsById.get(departmentId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    breadcrumbs.push(current)
    current = current.parent_id
      ? departmentsById.get(current.parent_id)
      : undefined
  }

  return breadcrumbs.reverse()
}

/**
 * Получить всех подчинённых пользователя рекурсивно.
 * Проходит по reports_to_user_id в department_members.
 * Возвращает плоский массив с depth (уровень вложенности).
 */
export function getAllSubordinates(
  members: DepartmentMember[],
  userId: string,
  depth = 1
): Array<DepartmentMember & { depth: number }> {
  const membersByManager = new Map<string, DepartmentMember[]>()

  for (const member of members) {
    if (!member.reports_to_user_id) continue
    const directReports = membersByManager.get(member.reports_to_user_id) || []
    directReports.push(member)
    membersByManager.set(member.reports_to_user_id, directReports)
  }

  const subordinates: Array<DepartmentMember & { depth: number }> = []
  const visited = new Set<string>([userId])

  function collectSubordinates(managerId: string, currentDepth: number) {
    for (const member of membersByManager.get(managerId) || []) {
      if (visited.has(member.user_id)) continue
      visited.add(member.user_id)
      subordinates.push({ ...member, depth: currentDepth })
      collectSubordinates(member.user_id, currentDepth + 1)
    }
  }

  collectSubordinates(userId, depth)
  return subordinates
}

/**
 * Получить цепочку руководителей вверх от userId.
 * Проходит по reports_to_user_id до корня (null).
 * Защита от бесконечных циклов через Set visited.
 */
export function getManagementChain(
  members: DepartmentMember[],
  userId: string
): DepartmentMember[] {
  const firstMembershipByUser = new Map<string, DepartmentMember>()

  for (const member of members) {
    if (!firstMembershipByUser.has(member.user_id)) {
      firstMembershipByUser.set(member.user_id, member)
    }
  }

  const chain: DepartmentMember[] = []
  const visited = new Set<string>([userId])
  let current = firstMembershipByUser.get(userId)

  while (current?.reports_to_user_id) {
    const managerId = current.reports_to_user_id
    if (visited.has(managerId)) break
    visited.add(managerId)

    const manager = firstMembershipByUser.get(managerId)
    if (!manager) break

    chain.push(manager)
    current = manager
  }

  return chain
}

/**
 * Плоский список → сгруппированный по отделам.
 * Используется для отображения «сотрудники по отделам».
 */
export function groupMembersByDepartment(
  members: DepartmentMember[]
): Map<string, DepartmentMember[]> {
  const grouped = new Map<string, DepartmentMember[]>()

  for (const member of members) {
    const departmentMembers = grouped.get(member.department_id) || []
    departmentMembers.push(member)
    grouped.set(member.department_id, departmentMembers)
  }

  return grouped
}

/**
 * Проверить можно ли назначить newParentId родителем для departmentId
 * без создания цикла. Работает на клиентских данных (без запросов к БД).
 */
export function wouldCreateCycle(
  departments: Department[],
  departmentId: string,
  newParentId: string | null
): boolean {
  if (!newParentId) return false
  if (newParentId === departmentId) return true

  const departmentsById = new Map(
    departments.map((department) => [department.id, department])
  )
  const visited = new Set<string>()
  let currentId: string | null = newParentId

  while (currentId) {
    if (currentId === departmentId) return true
    if (visited.has(currentId)) return true
    visited.add(currentId)

    currentId = departmentsById.get(currentId)?.parent_id ?? null
  }

  return false
}
