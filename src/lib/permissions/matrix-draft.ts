export type MatrixCell = {
  canView: boolean;
  canManage: boolean;
  factoryScope: "own" | "all";
  companyViewScope: "own" | "all";
  companyManageScope: "own" | "all";
};
export const EMPTY_MATRIX_CELL: MatrixCell = {
  canView: false,
  canManage: false,
  factoryScope: "own",
  companyViewScope: "own",
  companyManageScope: "own",
};
export function equalMatrixCell(a = EMPTY_MATRIX_CELL, b = EMPTY_MATRIX_CELL) {
  return (
    a.canView === b.canView &&
    a.canManage === b.canManage &&
    a.factoryScope === b.factoryScope &&
    a.companyViewScope === b.companyViewScope &&
    a.companyManageScope === b.companyManageScope
  );
}
/** Rebase untouched cells; keep local edits and identify edits to the same cell. */
export function reconcileMatrixDraft(
  base: Record<string, MatrixCell>,
  draft: Record<string, MatrixCell>,
  incoming: Record<string, MatrixCell>,
) {
  const next = { ...incoming };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(draft)])) {
    if (equalMatrixCell(base[key], draft[key])) continue;
    next[key] = draft[key];
    if (
      !equalMatrixCell(base[key], incoming[key]) &&
      !equalMatrixCell(draft[key], incoming[key])
    )
      conflicts.push(key);
  }
  return { draft: next, conflicts };
}
