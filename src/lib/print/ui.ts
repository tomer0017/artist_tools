// What of the print foundation the interface shows.
//
// Create a Grid's "Save PDF (A4)" button is hidden: the owner decided on
// 2026-11-18, after M2, that the saved PNG grid image is what is needed. The
// PDF code (src/lib/print), the `export.pdf` feature and their tests stay as
// they are, so the button can come back by setting this to true (the e2e
// tests for it follow the same switch).
export const GRID_PDF_BUTTON = false;
