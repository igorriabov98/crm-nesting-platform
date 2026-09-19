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
