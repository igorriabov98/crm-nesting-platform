export function flattenOrganizationTree<
  T extends { id: string; parent_id: string | null },
>(departments: readonly T[]): T[] {
  const result: T[] = [],
    seen = new Set<string>();
  const visit = (department: T) => {
    if (seen.has(department.id)) return;
    seen.add(department.id);
    result.push(department);
    departments
      .filter((child) => child.parent_id === department.id)
      .forEach(visit);
  };
  departments
    .filter(
      (department) =>
        !department.parent_id ||
        !departments.some((parent) => parent.id === department.parent_id),
    )
    .forEach(visit);
  departments.forEach(visit);
  return result;
}

/** Keep ancestors in search results so a matching subdepartment never looks like a root. */
export function organizationTreeRows<
  T extends { id: string; name: string; parent_id: string | null },
>(departments: readonly T[], search = "") {
  const byId = new Map(departments.map((row) => [row.id, row]));
  const visible = new Set<string>();
  for (const row of departments) {
    if (
      !row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
      continue;
    let current: T | undefined = row;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      visible.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }
  return flattenOrganizationTree(departments)
    .filter((row) => visible.has(row.id))
    .map((department) => {
      const path: string[] = [],
        seen = new Set([department.id]);
      let parent = department.parent_id
        ? byId.get(department.parent_id)
        : undefined;
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id);
        path.unshift(parent.name);
        parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
      }
      return { department, path, depth: path.length };
    });
}
