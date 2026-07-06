# Backlog

## Nesting

- `analyze-pdf` without `steelTypes` in the request body should return `400` or an explicit `catalogMissing` flag instead of silently adding a steel warning to every row.
- Reconciliation should support partial `thickness`/`qty` checks from BOM data when PDF unfolding dimensions are absent, instead of marking the whole row as `NO_PDF_DATA`.
- Extract structured quantity from detail drawing notes, for example `Кол-во: 6 шт.`, and apply it only after adding an explicit parser field and tests.
- Класс "сварная ёмкость": замкнутая коробчатая топология -> информативный статус "развёртка из документации" вместо тревожного `MISMATCH`.
- Unfold topology: отверстия не должны участвовать в выборе стартовой полки; отдельно спроектировать перенос отверстий, если они попадают в спорную зону гиба.
