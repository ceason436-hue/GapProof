# Private textbook ingestion

This converter creates page-level and section-level Markdown while preserving
the source SHA-256, PDF page, extraction status, and content hash.

The full conversion is private and must not be committed to Git. The source PDF
is never modified.

Run with the bundled Python runtime:

```powershell
& '<bundled-python>\python.exe' `
  tools\knowledge-ingestion\convert_textbook_pdf.py `
  reference\Textbook-materials\八年级英语上册.pdf `
  reference\Textbook-materials\private-ai-readable `
  --isbn 978-7-5720-3630-9 `
  --pdftoppm '<bundled-poppler>\pdftoppm.exe' `
  --visual-review-status pending
```

Outputs:

- `pages/page-NNNN.md`: source-traceable page extraction.
- `sections/*.md`: unit/section aggregation with stable page anchors.
- `tables/*.md`: machine-detected ruled tables; always requires review.
- `manifest.json`: source, processor, section, page, and QA metadata.
- `qa/*.json`: page statistics and flagged-page lists.
- `qa/rendered-pages/`: representative and flagged page renders.
- `qa/contact-sheets/`: compact visual-review sheets.
- `qa/validation-report.md`: conversion summary and remaining review gates.

The section ranges are explicit in the script. Update them only after comparing
the source table of contents and section-opening pages.

After a human has inspected all generated contact sheets, rerun with
`--visual-review-status completed` and a concise `--visual-review-notes` value
so the manifest does not confuse rendering with completed visual review.

## Private exam-material ingestion

`docx_to_markdown.py` inventories DOCX/PDF/MP3 bundles, extracts DOCX through
OOXML, separates student/answer/explanation roles, and writes a manifest plus
QA report beneath a private output directory. Source files remain read-only.

```powershell
& '<bundled-python>\python.exe' `
  tools\knowledge-ingestion\docx_to_markdown.py `
  --input-root reference\Exam-materials\incoming `
  --output-root reference\Exam-materials\private-ai-readable
```

Both input and output directories are excluded from Git. Only this converter,
source metadata, hashes/statistics, and project-owned synthetic fixtures may be
committed.

When Microsoft Word is available locally, `word_render_qa.ps1` can paginate all
DOCX records and render a representative role/layout sample to PDF for visual
QA. Rendered PDFs and result JSON must remain under the private output tree.
