#!/usr/bin/env python3
"""Convert a textbook PDF into private, traceable Markdown artifacts.

The converter never changes the source PDF. It produces page Markdown, section
Markdown, a machine-readable manifest, and QA reports. Full converted content
is intended for a private, git-excluded output directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

import pdfplumber
from pypdf import PdfReader


SECTIONS = [
    ("front-matter", "Front matter", 1, 7),
    ("unit-01-water", "Unit 1 - Water", 8, 23),
    ("unit-02-digital-life", "Unit 2 - Digital life", 24, 39),
    ("unit-03-curious-minds", "Unit 3 - Curious minds", 40, 55),
    ("unit-04-then-and-now", "Unit 4 - Then and now", 56, 71),
    ("unit-05-teamwork", "Unit 5 - Teamwork", 72, 87),
    ("unit-06-life-in-the-future", "Unit 6 - Life in the future", 88, 103),
    ("culture-corner", "Culture Corner", 104, 109),
    ("literature", "Literature", 110, 114),
    ("appendices", "Appendices", 115, 139),
    ("word-bank", "Word Bank", 140, 159),
    ("back-matter", "Back matter", 160, 161),
]

VISUAL_QA_PAGES = sorted(
    {
        1, 2, 3, 4, 8, 10, 20, 24, 30, 40, 50, 56, 64, 72, 80, 88,
        96, 104, 106, 110, 112, 115, 120, 140, 150, 160, 161,
    }
)


@dataclass
class PageRecord:
    pdf_page: int
    printed_page: int | None
    section_id: str
    markdown_path: str
    raw_chars: int
    normalized_chars: int
    line_count: int
    control_char_count: int
    replacement_char_count: int
    image_xobject_count: int
    detected_table_count: int
    extraction_status: str
    content_sha256: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_text(text: str) -> tuple[str, int]:
    normalized = unicodedata.normalize("NFC", text.replace("\r\n", "\n"))
    controls = sum(
        1
        for char in normalized
        if unicodedata.category(char) == "Cc" and char not in "\n\t"
    )
    normalized = "".join(
        char
        for char in normalized
        if unicodedata.category(char) != "Cc" or char in "\n\t"
    )
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in normalized.splitlines()]
    compact: list[str] = []
    previous_blank = False
    for line in lines:
        is_blank = not line
        if not (is_blank and previous_blank):
            compact.append(line)
        previous_blank = is_blank
    return "\n".join(compact).strip(), controls


def yaml_scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def section_for(page_number: int) -> tuple[str, str, int, int]:
    for section in SECTIONS:
        if section[2] <= page_number <= section[3]:
            return section
    raise ValueError(f"No section mapping for PDF page {page_number}")


def printed_page_for(pdf_page: int) -> int | None:
    return pdf_page - 6 if 8 <= pdf_page <= 159 else None


def image_count(page: Any) -> int:
    try:
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject") or {}
        if hasattr(xobjects, "get_object"):
            xobjects = xobjects.get_object()
        count = 0
        for item in xobjects.values():
            item = item.get_object()
            if item.get("/Subtype") == "/Image":
                count += 1
        return count
    except Exception:
        return 0


def markdown_table(table: list[list[str | None]]) -> str:
    rows = [[(cell or "").replace("\n", " ").replace("|", "\\|") for cell in row] for row in table]
    if not rows or not rows[0]:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header = rows[0]
    body = rows[1:]
    output = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * width) + " |"]
    output.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(output)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render_pages(pdf: Path, output: Path, executable: Path, pages: list[int]) -> list[dict[str, Any]]:
    output.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for page in pages:
        prefix = output / f"page-{page:04d}"
        command = [
            str(executable), "-f", str(page), "-l", str(page), "-r", "110",
            "-png", "-singlefile", str(pdf), str(prefix),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        rendered = prefix.with_suffix(".png")
        results.append(
            {
                "pdf_page": page,
                "status": "rendered" if completed.returncode == 0 and rendered.exists() else "failed",
                "path": rendered.relative_to(output.parent.parent).as_posix() if rendered.exists() else None,
                "stderr": completed.stderr.strip(),
            }
        )
    return results


def build_contact_sheets(image_paths: list[Path], output: Path) -> list[str]:
    from PIL import Image, ImageDraw

    output.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    for batch_index in range(0, len(image_paths), 8):
        batch = image_paths[batch_index : batch_index + 8]
        thumbs: list[tuple[Path, Image.Image]] = []
        for path in batch:
            image = Image.open(path).convert("RGB")
            image.thumbnail((200, 580))
            thumbs.append((path, image.copy()))
            image.close()
        sheet = Image.new("RGB", (900, 2 * 630), "white")
        draw = ImageDraw.Draw(sheet)
        for index, (path, image) in enumerate(thumbs):
            col = index % 4
            row = index // 4
            x, y = 20 + col * 220, 40 + row * 630
            sheet.paste(image, (x, y))
            draw.text((x, y - 24), path.stem, fill="black")
        sheet_path = output / f"contact-sheet-{batch_index // 8 + 1:02d}.jpg"
        sheet.save(sheet_path, quality=88)
        created.append(sheet_path.name)
    return created


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--isbn", required=True)
    parser.add_argument("--title", default="义务教育教科书（五·四学制）英语 八年级上册")
    parser.add_argument("--pdftoppm", type=Path)
    parser.add_argument(
        "--visual-review-status",
        choices=["pending", "completed"],
        default="pending",
    )
    parser.add_argument("--visual-review-notes", default="")
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_file():
        raise SystemExit(f"Source PDF does not exist: {source}")

    output.mkdir(parents=True, exist_ok=True)
    pages_dir = output / "pages"
    sections_dir = output / "sections"
    tables_dir = output / "tables"
    qa_dir = output / "qa"
    for directory in (pages_dir, sections_dir, tables_dir, qa_dir):
        directory.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(source))
    if len(reader.pages) != 161:
        raise SystemExit(f"Expected 161 pages, found {len(reader.pages)}")

    source_hash = sha256_file(source)
    page_records: list[PageRecord] = []
    section_fragments: dict[str, list[str]] = {section[0]: [] for section in SECTIONS}

    # Full-document ruled-table detection is intentionally avoided: on visual
    # textbooks it is slow and produces many false positives from decorative
    # boxes. Detect tables on the visual-QA sample and preserve every page's
    # source reference so remaining layouts can be reviewed against the PDF.
    table_map: dict[int, list[list[list[str | None]]]] = {}
    with pdfplumber.open(str(source)) as plumber:
        for page_number in VISUAL_QA_PAGES:
            table_map[page_number] = plumber.pages[page_number - 1].extract_tables(
                table_settings={"vertical_strategy": "lines", "horizontal_strategy": "lines"}
            )

    for index, page in enumerate(reader.pages, start=1):
            raw_text = page.extract_text() or ""
            text, control_count = clean_text(raw_text)
            section_id, section_title, _, _ = section_for(index)
            tables = table_map.get(index, [])
            table_blocks: list[str] = []
            for table_index, table in enumerate(tables, start=1):
                rendered = markdown_table(table)
                if rendered:
                    table_path = tables_dir / f"page-{index:04d}-table-{table_index:02d}.md"
                    table_path.write_text(
                        f"# PDF page {index} - table {table_index}\n\n"
                        "> Machine-extracted from ruled lines; human review required.\n\n"
                        + rendered
                        + "\n",
                        encoding="utf-8",
                    )
                    table_blocks.append(
                        f"- [Table {table_index}](../tables/{table_path.name}) - machine extracted, unreviewed"
                    )

            status = "ok"
            if not text:
                status = "empty"
            elif len(text) < 100:
                status = "sparse_visual_review_required"
            elif control_count:
                status = "cleaned_control_characters"

            content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            page_path = pages_dir / f"page-{index:04d}.md"
            frontmatter = [
                "---",
                f"source_sha256: {source_hash}",
                f"isbn: {yaml_scalar(args.isbn)}",
                f"pdf_page: {index}",
                f"printed_page: {printed_page_for(index) if printed_page_for(index) is not None else 'null'}",
                f"section_id: {yaml_scalar(section_id)}",
                f"extraction_status: {yaml_scalar(status)}",
                f"content_sha256: {content_hash}",
                "review_status: machine_extracted_unreviewed",
                "distribution: private_not_for_git",
                "---",
                "",
            ]
            body = [
                f"# PDF page {index:04d}",
                "",
                f"> Source: {args.title}; ISBN {args.isbn}; PDF page {index}.",
                "> Text order is machine extracted and must be checked against the source page before citation-sensitive use.",
                "",
                "## Extracted text",
                "",
                text or "[No extractable text]",
            ]
            if table_blocks:
                body.extend(["", "## Detected ruled tables", "", *table_blocks])
            page_markdown = "\n".join(frontmatter + body).rstrip() + "\n"
            page_path.write_text(page_markdown, encoding="utf-8")

            anchor = f'<a id="pdf-page-{index:04d}"></a>'
            section_fragments[section_id].append(
                f"{anchor}\n\n## PDF page {index}"
                + (f" / printed page {printed_page_for(index)}" if printed_page_for(index) is not None else "")
                + f"\n\n{text or '[No extractable text]'}\n"
            )
            page_records.append(
                PageRecord(
                    pdf_page=index,
                    printed_page=printed_page_for(index),
                    section_id=section_id,
                    markdown_path=page_path.relative_to(output).as_posix(),
                    raw_chars=len(raw_text),
                    normalized_chars=len(text),
                    line_count=len(text.splitlines()),
                    control_char_count=control_count,
                    replacement_char_count=text.count("\ufffd"),
                    image_xobject_count=image_count(page),
                    detected_table_count=len(table_blocks),
                    extraction_status=status,
                    content_sha256=content_hash,
                )
            )

    for section_id, section_title, start_page, end_page in SECTIONS:
        section_path = sections_dir / f"{section_id}.md"
        section_path.write_text(
            "\n".join(
                [
                    "---",
                    f"source_sha256: {source_hash}",
                    f"isbn: {yaml_scalar(args.isbn)}",
                    f"section_id: {yaml_scalar(section_id)}",
                    f"pdf_pages: {yaml_scalar(f'{start_page}-{end_page}')}",
                    "review_status: machine_extracted_unreviewed",
                    "distribution: private_not_for_git",
                    "---",
                    "",
                    f"# {section_title}",
                    "",
                    *section_fragments[section_id],
                ]
            ).rstrip()
            + "\n",
            encoding="utf-8",
        )

    char_counts = [record.normalized_chars for record in page_records]
    sparse_pages = [record.pdf_page for record in page_records if record.normalized_chars < 100]
    control_pages = [record.pdf_page for record in page_records if record.control_char_count]
    duplicate_groups: dict[str, list[int]] = {}
    for record in page_records:
        duplicate_groups.setdefault(record.content_sha256, []).append(record.pdf_page)
    duplicates = [pages for pages in duplicate_groups.values() if len(pages) > 1]

    rendered_pages: list[dict[str, Any]] = []
    contact_sheets: list[str] = []
    visual_pages = sorted(set(VISUAL_QA_PAGES + sparse_pages))
    if args.pdftoppm:
        rendered_pages = render_pages(source, qa_dir / "rendered-pages", args.pdftoppm.resolve(), visual_pages)
        image_paths = [qa_dir / "rendered-pages" / f"page-{page:04d}.png" for page in visual_pages]
        image_paths = [path for path in image_paths if path.exists()]
        contact_sheets = build_contact_sheets(image_paths, qa_dir / "contact-sheets")

    generated_at = datetime.now(timezone.utc).isoformat()
    manifest = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source": {
            "title": args.title,
            "isbn": args.isbn,
            "file_name": source.name,
            "sha256": source_hash,
            "byte_size": source.stat().st_size,
            "pdf_pages": len(reader.pages),
            "license_status": "user_confirmed_online_purchase",
            "allowed_public_display": True,
            "full_conversion_distribution": "private_not_for_git",
        },
        "processor": {
            "name": "convert_textbook_pdf.py",
            "pypdf_version": __import__("pypdf").__version__,
            "pdfplumber_version": pdfplumber.__version__,
            "normalization": "Unicode NFC; non-tab/newline control characters removed",
            "table_detection_scope": f"visual QA pages only: {VISUAL_QA_PAGES}",
        },
        "summary": {
            "total_normalized_chars": sum(char_counts),
            "median_chars_per_page": median(char_counts),
            "sparse_pages_under_100_chars": sparse_pages,
            "control_character_pages": control_pages,
            "replacement_character_total": sum(record.replacement_char_count for record in page_records),
            "image_xobject_total": sum(record.image_xobject_count for record in page_records),
            "detected_ruled_table_total": sum(record.detected_table_count for record in page_records),
            "duplicate_page_groups": duplicates,
        },
        "sections": [
            {
                "section_id": section_id,
                "title": title,
                "pdf_page_start": start,
                "pdf_page_end": end,
                "markdown_path": f"sections/{section_id}.md",
            }
            for section_id, title, start, end in SECTIONS
        ],
        "pages": [asdict(record) for record in page_records],
        "visual_qa": {
            "selected_pages": visual_pages,
            "render_results": rendered_pages,
            "contact_sheets": contact_sheets,
            "review_status": (
                "human_visual_review_completed"
                if rendered_pages and args.visual_review_status == "completed"
                else "rendered_pending_human_visual_review"
                if rendered_pages
                else "not_rendered"
            ),
            "review_notes": args.visual_review_notes,
        },
    }
    write_json(output / "manifest.json", manifest)
    write_json(qa_dir / "page-stats.json", [asdict(record) for record in page_records])
    write_json(
        qa_dir / "flagged-pages.json",
        {
            "sparse_pages_under_100_chars": sparse_pages,
            "control_character_pages": control_pages,
            "duplicate_page_groups": duplicates,
            "visual_qa_pages": visual_pages,
        },
    )

    qa_lines = [
        "# Textbook conversion QA report",
        "",
        f"- Generated: `{generated_at}`",
        f"- Source SHA-256: `{source_hash}`",
        f"- ISBN: `{args.isbn}`",
        f"- PDF pages: `{len(reader.pages)}`",
        f"- Page Markdown files: `{len(page_records)}`",
        f"- Section Markdown files: `{len(SECTIONS)}`",
        f"- Total normalized characters: `{sum(char_counts)}`",
        f"- Median characters per page: `{median(char_counts)}`",
        f"- Sparse pages (<100 chars): `{sparse_pages}`",
        f"- Pages with removed control characters: `{control_pages}`",
        f"- Replacement characters: `{sum(record.replacement_char_count for record in page_records)}`",
        f"- Embedded image XObjects: `{sum(record.image_xobject_count for record in page_records)}`",
        f"- Machine-detected ruled tables: `{sum(record.detected_table_count for record in page_records)}`",
        f"- Duplicate content groups: `{duplicates}`",
        f"- Visual QA selection: `{visual_pages}`",
        f"- Rendered visual QA pages: `{sum(1 for item in rendered_pages if item['status'] == 'rendered')}`",
        f"- Visual review status: `{manifest['visual_qa']['review_status']}`",
        f"- Visual review notes: {args.visual_review_notes or 'None recorded.'}",
        "",
        "## Required human checks",
        "",
        "- Compare every sparse page and section boundary against the rendered source.",
        "- Check multi-column reading order, exercise numbering, answer choices, captions, and footnotes.",
        "- Treat extracted tables as unreviewed until row/column structure is checked.",
        "- Images are counted but not semantically described; consult the source page for image-dependent tasks.",
        "- Do not commit this private full-text conversion to Git.",
    ]
    (qa_dir / "validation-report.md").write_text("\n".join(qa_lines) + "\n", encoding="utf-8")

    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
