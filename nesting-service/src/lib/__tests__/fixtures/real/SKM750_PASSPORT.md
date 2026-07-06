# SKM-750 regression passport

Purpose: real-file regression for non-sheet profile handling.

Expected classification:
- `Kufe` / position 6 / `U 80 - 690`: `PROFILE`, matched from `Stückliste`, not nested.
- `Achse` / position 8 / `RU 16 - 60`: `PROFILE`, matched from `Stückliste`, not nested.
- Sheet `BL ...` rows remain `SHEET`.

Expected reconciliation:
- unmatched BOM rows: `0`
- `PROFILE` parts do not create `NO_PDF_DATA`
- DXF/SVG contain only `SHEET` placements

Expected summary:
- total parts: `15`
- profile parts: `4`
- placed sheet parts: `9`
- placed sheet parts with available `t20` sheet: `11`
