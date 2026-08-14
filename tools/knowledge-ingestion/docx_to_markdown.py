#!/usr/bin/env python3
"""Convert an exam-material bundle into Markdown plus a reproducible manifest.

The converter is intentionally non-destructive: source files are opened read-only,
the source directory is never modified, and all derived files are written beneath
the selected output directory. DOCX conversion uses OOXML directly so it does not
depend on Microsoft Word or LibreOffice. Optional render results can be merged from
a separate JSON file produced by a layout renderer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from lxml import etree
from pypdf import PdfReader


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS, "a": A_NS, "m": M_NS, "pr": PKG_REL_NS}

RIGHTS = {
    "status": "user_asserted_permitted",
    "assertion": "User stated the materials were purchased online and may be used directly without copyright restriction.",
    "evidence_status": "pending",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_rel(path: Path) -> str:
    return path.as_posix()


def classify(relative_path: str, extension: str) -> tuple[str, list[str]]:
    name = relative_path.lower()
    tags: list[str] = []

    if extension == ".mp3":
        return "listening_audio", ["listening", "audio"]
    if "答题卡" in name:
        return "answer_sheet", ["answer_sheet"]
    if "解析版" in name or "详解" in name:
        return "answer_explanation", ["answers", "explanations"]
    if "参考答案" in name or "答案版" in name:
        return "answer_key", ["answers"]
    if "考试版" in name or "原卷版" in name:
        return "student_exam", ["student_facing", "assessment"]
    if "挖空版" in name or "默写版" in name:
        return "student_practice", ["student_facing", "fill_in"]
    if "背诵版" in name:
        return "study_sheet", ["study_sheet"]
    if "知识清单" in name or "知识" in name:
        tags.append("knowledge_sheet")
    if any(marker in name for marker in ("试卷", "测试", "模拟卷", "月考", "期中", "期末")):
        tags.append("assessment")
    if any(marker in name for marker in ("精练", "练习")):
        tags.append("practice")
    if extension == ".pdf":
        tags.append("pdf")
    return (tags[0] if tags else "unclassified"), tags


def parse_xml(data: bytes) -> etree._Element:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True)
    return etree.fromstring(data, parser=parser)


def load_style_names(archive: zipfile.ZipFile) -> dict[str, str]:
    if "word/styles.xml" not in archive.namelist():
        return {}
    root = parse_xml(archive.read("word/styles.xml"))
    result: dict[str, str] = {}
    for style in root.xpath(".//w:style", namespaces=NS):
        style_id = style.get(f"{{{W_NS}}}styleId")
        name_nodes = style.xpath("./w:name", namespaces=NS)
        if style_id and name_nodes:
            result[style_id] = name_nodes[0].get(f"{{{W_NS}}}val", style_id)
    return result


def load_relationships(archive: zipfile.ZipFile) -> dict[str, str]:
    rel_path = "word/_rels/document.xml.rels"
    if rel_path not in archive.namelist():
        return {}
    root = parse_xml(archive.read(rel_path))
    result: dict[str, str] = {}
    for rel in root.xpath(".//pr:Relationship", namespaces=NS):
        rel_id = rel.get("Id")
        target = rel.get("Target")
        if rel_id and target:
            result[rel_id] = target
    return result


def safe_media_member(target: str) -> str | None:
    candidate = PurePosixPath("word") / PurePosixPath(target)
    normalized = PurePosixPath(*[part for part in candidate.parts if part not in (".", "")])
    if ".." in normalized.parts or not str(normalized).startswith("word/media/"):
        return None
    return str(normalized)


def escape_table_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\r", "").replace("\n", "<br>").strip()


def element_content(
    element: etree._Element,
    relationships: dict[str, str],
    image_links: dict[str, str],
) -> str:
    parts: list[str] = []
    seen_blips: set[str] = set()
    for node in element.iter():
        if node.tag == f"{{{W_NS}}}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{{{W_NS}}}tab":
            parts.append("\t")
        elif node.tag in (f"{{{W_NS}}}br", f"{{{W_NS}}}cr"):
            parts.append("\n")
        elif node.tag == f"{{{A_NS}}}blip":
            rel_id = node.get(f"{{{R_NS}}}embed")
            if rel_id and rel_id not in seen_blips:
                seen_blips.add(rel_id)
                target = relationships.get(rel_id)
                if target and target in image_links:
                    parts.append(f" ![embedded image]({image_links[target]}) ")
                else:
                    parts.append(" [embedded image: unresolved] ")
    text = "".join(parts)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


def paragraph_markdown(
    paragraph: etree._Element,
    styles: dict[str, str],
    relationships: dict[str, str],
    image_links: dict[str, str],
) -> str:
    text = element_content(paragraph, relationships, image_links)
    if not text:
        return ""
    style_nodes = paragraph.xpath("./w:pPr/w:pStyle", namespaces=NS)
    style_id = style_nodes[0].get(f"{{{W_NS}}}val", "") if style_nodes else ""
    style_name = styles.get(style_id, style_id).lower()
    heading_match = re.search(r"heading\s*([1-6])", style_name)
    if not heading_match:
        heading_match = re.search(r"标题\s*([1-6])", style_name)
    if heading_match:
        return f"{'#' * (int(heading_match.group(1)) + 1)} {text}"
    if "title" in style_name or "标题" == style_name:
        return f"# {text}"
    if paragraph.xpath("./w:pPr/w:numPr", namespaces=NS):
        return f"- {text}"
    return text


def table_markdown(
    table: etree._Element,
    relationships: dict[str, str],
    image_links: dict[str, str],
) -> str:
    rows: list[list[str]] = []
    for row in table.xpath("./w:tr", namespaces=NS):
        cells = [
            escape_table_cell(element_content(cell, relationships, image_links))
            for cell in row.xpath("./w:tc", namespaces=NS)
        ]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(padded[0]) + " |"]
    lines.append("| " + " | ".join(["---"] * width) + " |")
    lines.extend("| " + " | ".join(row) + " |" for row in padded[1:])
    return "\n".join(lines)


def app_page_count(archive: zipfile.ZipFile) -> int | None:
    if "docProps/app.xml" not in archive.namelist():
        return None
    root = parse_xml(archive.read("docProps/app.xml"))
    nodes = root.xpath("//*[local-name()='Pages']")
    if not nodes or not nodes[0].text:
        return None
    try:
        return int(nodes[0].text)
    except ValueError:
        return None


def extract_docx(
    source: Path,
    output_md: Path,
    output_md_relative: Path,
    assets_dir: Path,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "failed",
        "output_markdown": normalize_rel(output_md_relative),
        "paragraph_count": 0,
        "table_count": 0,
        "image_count": 0,
        "equation_count": 0,
        "comment_count": 0,
        "tracked_change_count": 0,
        "ole_object_count": 0,
        "alt_chunk_count": 0,
        "xml_text_characters": 0,
        "markdown_characters": 0,
        "max_markdown_line_characters": 0,
        "max_table_cell_characters": 0,
        "max_table_columns": 0,
        "max_table_rows": 0,
        "duplicate_block_ratio": 0.0,
        "layout_dependency": "normal",
        "app_property_page_count": None,
        "warnings": [],
    }
    try:
        with zipfile.ZipFile(source) as archive:
            names = set(archive.namelist())
            if "word/document.xml" not in names:
                raise ValueError("missing word/document.xml")
            document = parse_xml(archive.read("word/document.xml"))
            styles = load_style_names(archive)
            relationships = load_relationships(archive)

            image_links: dict[str, str] = {}
            for target in sorted(set(relationships.values())):
                member = safe_media_member(target)
                if not member or member not in names:
                    continue
                asset_path = assets_dir / Path(member).name
                asset_path.parent.mkdir(parents=True, exist_ok=True)
                asset_path.write_bytes(archive.read(member))
                image_links[target] = normalize_rel(Path(output_md.stem + "_assets") / asset_path.name)

            body_nodes = document.xpath("/w:document/w:body/*", namespaces=NS)
            blocks: list[str] = []
            paragraph_count = 0
            table_count = 0
            for node in body_nodes:
                if node.tag == f"{{{W_NS}}}p":
                    paragraph_count += 1
                    block = paragraph_markdown(node, styles, relationships, image_links)
                elif node.tag == f"{{{W_NS}}}tbl":
                    table_count += 1
                    block = table_markdown(node, relationships, image_links)
                else:
                    block = ""
                if block:
                    blocks.append(block)

            xml_text = "".join(document.xpath(".//w:t/text()", namespaces=NS))
            comment_count = 0
            if "word/comments.xml" in names:
                comments = parse_xml(archive.read("word/comments.xml"))
                comment_count = len(comments.xpath(".//w:comment", namespaces=NS))

            frontmatter = [
                "---",
                f"source_relative_path: {json.dumps(metadata['relative_path'], ensure_ascii=False)}",
                f"source_sha256: {metadata['sha256']}",
                f"classification: {metadata['classification']}",
                "rights_status: user_asserted_permitted",
                "rights_evidence_status: pending",
                "conversion: ooxml_to_markdown_v1",
                "---",
                "",
            ]
            markdown = "\n".join(frontmatter + blocks).strip() + "\n"
            output_md.parent.mkdir(parents=True, exist_ok=True)
            output_md.write_text(markdown, encoding="utf-8", newline="\n")

            normalized_blocks = [
                re.sub(r"\s+", " ", block).strip()
                for block in blocks
                if len(re.sub(r"\s+", " ", block).strip()) >= 40
            ]
            duplicate_ratio = (
                1.0 - (len(set(normalized_blocks)) / len(normalized_blocks))
                if normalized_blocks
                else 0.0
            )
            table_nodes = document.xpath("/w:document/w:body/w:tbl", namespaces=NS)
            table_cell_lengths = [
                len(element_content(cell, relationships, image_links))
                for table in table_nodes
                for cell in table.xpath(".//w:tc", namespaces=NS)
            ]
            table_columns = [
                max(
                    (len(row.xpath("./w:tc", namespaces=NS)) for row in table.xpath("./w:tr", namespaces=NS)),
                    default=0,
                )
                for table in table_nodes
            ]
            table_rows = [len(table.xpath("./w:tr", namespaces=NS)) for table in table_nodes]
            max_line = max((len(line) for line in markdown.splitlines()), default=0)
            max_cell = max(table_cell_lengths, default=0)
            max_columns = max(table_columns, default=0)
            max_rows = max(table_rows, default=0)
            layout_dependency = "high" if metadata["classification"] == "answer_sheet" else "normal"
            if max_cell > 800 or max_columns > 8:
                layout_dependency = "high"

            result.update(
                {
                    "status": "converted",
                    "paragraph_count": paragraph_count,
                    "table_count": table_count,
                    "image_count": len(image_links),
                    "equation_count": len(document.xpath(".//m:oMath | .//m:oMathPara", namespaces=NS)),
                    "comment_count": comment_count,
                    "tracked_change_count": len(document.xpath(".//w:ins | .//w:del", namespaces=NS)),
                    "ole_object_count": len(document.xpath(".//*[local-name()='OLEObject']")),
                    "alt_chunk_count": len(document.xpath(".//w:altChunk", namespaces=NS)),
                    "xml_text_characters": len(xml_text),
                    "markdown_characters": len(markdown),
                    "max_markdown_line_characters": max_line,
                    "max_table_cell_characters": max_cell,
                    "max_table_columns": max_columns,
                    "max_table_rows": max_rows,
                    "duplicate_block_ratio": round(duplicate_ratio, 4),
                    "layout_dependency": layout_dependency,
                    "app_property_page_count": app_page_count(archive),
                }
            )
            if len(xml_text.strip()) < 40:
                result["warnings"].append("very_low_text_content")
            if result["ole_object_count"]:
                result["warnings"].append("embedded_ole_requires_manual_review")
            if result["alt_chunk_count"]:
                result["warnings"].append("alt_chunk_requires_manual_review")
            if "[embedded image: unresolved]" in markdown:
                result["warnings"].append("unresolved_embedded_image")
            if metadata["classification"] == "answer_sheet":
                result["warnings"].append("layout_dependent_answer_sheet_not_for_direct_question_ingestion")
            if max_cell > 800 or max_columns > 8:
                result["warnings"].append("complex_table_layout_requires_manual_review")
            if max_line > 4000:
                result["warnings"].append("very_long_markdown_line")
            if duplicate_ratio >= 0.12:
                result["warnings"].append("high_duplicate_block_ratio")
    except Exception as exc:  # per-file failure must not abort a 191-file batch
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def pdf_metadata(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "failed",
        "page_count": None,
        "text_layer_characters": None,
        "has_text_layer": None,
        "encrypted": None,
        "visual_status": "not_rendered",
        "warnings": [],
    }
    try:
        reader = PdfReader(str(path))
        result["encrypted"] = bool(reader.is_encrypted)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                result["warnings"].append("encrypted_pdf_requires_manual_review")
        total_chars = 0
        text_failures = 0
        for page in reader.pages:
            try:
                total_chars += len((page.extract_text() or "").strip())
            except Exception:
                text_failures += 1
        result.update(
            {
                "status": "inspected",
                "page_count": len(reader.pages),
                "text_layer_characters": total_chars,
                "has_text_layer": total_chars > 20,
            }
        )
        if text_failures:
            result["warnings"].append(f"text_extraction_failed_pages:{text_failures}")
        if total_chars <= 20:
            result["warnings"].append("no_meaningful_text_layer")
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


BITRATES = {
    (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    (25, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}
SAMPLE_RATES = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000]}


def mp3_duration(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    offset = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        offset = 10 + size
    duration = 0.0
    frames = 0
    recognized = 0
    sample_rates: Counter[int] = Counter()
    pos = offset
    while pos + 4 <= len(data):
        header = struct.unpack(">I", data[pos : pos + 4])[0]
        if (header & 0xFFE00000) != 0xFFE00000:
            pos += 1
            continue
        version_bits = (header >> 19) & 0x3
        layer_bits = (header >> 17) & 0x3
        bitrate_index = (header >> 12) & 0xF
        sample_index = (header >> 10) & 0x3
        padding = (header >> 9) & 0x1
        version = {3: 1, 2: 2, 0: 25}.get(version_bits)
        layer = {1: 3}.get(layer_bits)
        if version is None or layer != 3 or sample_index == 3:
            pos += 1
            continue
        bitrate_kbps = BITRATES[(version, layer)][bitrate_index]
        sample_rate = SAMPLE_RATES[version][sample_index]
        if bitrate_kbps <= 0 or sample_rate <= 0:
            pos += 1
            continue
        samples_per_frame = 1152 if version == 1 else 576
        coefficient = 144 if version == 1 else 72
        frame_length = int(coefficient * bitrate_kbps * 1000 / sample_rate + padding)
        if frame_length < 4 or pos + frame_length > len(data):
            pos += 1
            continue
        duration += samples_per_frame / sample_rate
        frames += 1
        recognized += frame_length
        sample_rates[sample_rate] += 1
        pos += frame_length
    coverage = recognized / max(1, len(data) - offset)
    result = {
        "status": "inspected" if frames else "failed",
        "duration_seconds": round(duration, 3) if frames else None,
        "duration_method": "mpeg_frame_scan" if frames else None,
        "frame_count": frames,
        "audio_byte_coverage": round(coverage, 4),
        "dominant_sample_rate_hz": sample_rates.most_common(1)[0][0] if sample_rates else None,
        "purpose": "listening_audio",
        "transcription_status": "not_requested",
        "warnings": [],
    }
    if not frames:
        result["warnings"].append("mp3_frames_not_detected")
    elif coverage < 0.9:
        result["warnings"].append("low_mpeg_frame_coverage")
    return result


def load_render_results(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "files" in payload:
        return {item["relative_path"]: item for item in payload["files"]}
    if isinstance(payload, list):
        return {item["relative_path"]: item for item in payload}
    return payload if isinstance(payload, dict) else {}


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def make_qa_report(manifest: dict[str, Any]) -> str:
    records = manifest["files"]
    by_ext = Counter(record["extension"] for record in records)
    by_class = Counter(record["classification"] for record in records)
    converted = [r for r in records if r["extension"] == ".docx" and r.get("conversion", {}).get("status") == "converted"]
    failed = [r for r in records if r["extension"] == ".docx" and r.get("conversion", {}).get("status") != "converted"]
    warnings = [r for r in records if r.get("conversion", {}).get("warnings") or r.get("inspection", {}).get("warnings")]
    rendered = [r for r in records if r.get("render", {}).get("status") == "rendered"]
    render_failed = [r for r in records if r.get("render", {}).get("status") == "failed"]
    visual_reviewed = [r for r in records if r.get("render", {}).get("visual_status") in ("passed", "needs_review")]

    lines = [
        "# 试卷材料转换 QA 报告",
        "",
        f"- 生成时间：`{manifest['generated_at']}`",
        f"- 输入文件总数：**{len(records)}**",
        f"- DOCX：**{by_ext['.docx']}**；PDF：**{by_ext['.pdf']}**；MP3：**{by_ext['.mp3']}**",
        f"- DOCX 成功转换：**{len(converted)}**；失败：**{len(failed)}**",
        f"- 已获得渲染页数：**{len(rendered)}**；渲染失败：**{len(render_failed)}**",
        f"- 已做代表性视觉核验：**{len(visual_reviewed)}**",
        "- 权利状态：`user_asserted_permitted`；凭证状态：`pending`。",
        "",
        "## 分类统计",
        "",
        "| 分类 | 文件数 |",
        "|---|---:|",
    ]
    lines.extend(f"| `{key}` | {value} |" for key, value in sorted(by_class.items()))
    lines.extend(["", "## 结构门禁", ""])
    if failed:
        lines.append("以下 DOCX 未能转换，需要人工处理：")
        lines.extend(f"- `{r['relative_path']}`：`{r.get('conversion', {}).get('error', 'unknown')}`" for r in failed)
    else:
        lines.append("全部 DOCX 均可打开并生成 UTF-8 Markdown。")
    if warnings:
        lines.extend(["", "以下文件触发结构或媒体警告，需要按清单复核："])
        for record in warnings:
            warning_values = record.get("conversion", {}).get("warnings", []) + record.get("inspection", {}).get("warnings", [])
            lines.append(f"- `{record['relative_path']}`：`{', '.join(warning_values)}`")
    else:
        lines.extend(["", "未发现低文本、未解析媒体、OLE、altChunk 或 PDF 文本层警告。"])
    lines.extend(
        [
            "",
            "## 渲染与视觉 QA",
            "",
            "DOCX 页数优先采用实际渲染或 Word 分页结果；`docProps/app.xml` 页数仅作为非权威参考。",
            "批量材料通过结构门禁，视觉检查采用分类、目录和版式变体的代表性样本，不据此声称每一页均已人工目视确认。",
            "",
            "## PDF 与音频",
            "",
            "PDF 仅登记页数、文本层和视觉状态；MP3 仅登记哈希、时长与听力用途，不进行转写。",
            "答题卡和复杂表格属于版式依赖材料，不得直接作为 AI 题库正文；题目抽取优先采用 `student_exam`，答案与讲解优先采用 `answer_explanation`，并通过相对路径和文件名关联。",
            "",
            "## 使用边界",
            "",
            "本目录是私有 AI 可读派生材料。权利结论来自用户陈述，尚未附购买凭证或授权文件；不得据此推断可公开再分发。",
            "",
        ]
    )
    return "\n".join(lines)


def iter_source_files(input_root: Path) -> Iterable[Path]:
    return sorted(
        (path for path in input_root.rglob("*") if path.is_file() and path.suffix.lower() in {".docx", ".pdf", ".mp3"}),
        key=lambda path: normalize_rel(path.relative_to(input_root)).casefold(),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--render-results", type=Path, help="Optional JSON keyed by source relative path")
    args = parser.parse_args()

    input_root = args.input_root.resolve()
    output_root = args.output_root.resolve()
    if input_root == output_root or input_root in output_root.parents:
        raise SystemExit("output root must not be the input root or one of its descendants")
    output_root.mkdir(parents=True, exist_ok=True)
    render_results = load_render_results(args.render_results)

    records: list[dict[str, Any]] = []
    for source in iter_source_files(input_root):
        relative = source.relative_to(input_root)
        relative_string = normalize_rel(relative)
        extension = source.suffix.lower()
        classification, tags = classify(relative_string, extension)
        record: dict[str, Any] = {
            "relative_path": relative_string,
            "extension": extension,
            "media_type": {
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".pdf": "application/pdf",
                ".mp3": "audio/mpeg",
            }[extension],
            "size_bytes": source.stat().st_size,
            "mtime_utc": datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
            "sha256": sha256_file(source),
            "classification": classification,
            "tags": tags,
            "rights": dict(RIGHTS),
        }
        if extension == ".docx":
            output_md_relative = relative.with_suffix(".md")
            output_md = output_root / output_md_relative
            assets_dir = output_md.parent / (output_md.stem + "_assets")
            record["conversion"] = extract_docx(source, output_md, output_md_relative, assets_dir, record)
        elif extension == ".pdf":
            record["inspection"] = pdf_metadata(source)
            if classification == "answer_sheet":
                record["inspection"]["layout_dependency"] = "high"
                record["inspection"]["warnings"].append(
                    "layout_dependent_answer_sheet_not_for_direct_question_ingestion"
                )
        else:
            record["inspection"] = mp3_duration(source)
        if relative_string in render_results:
            record["render"] = render_results[relative_string]
            if extension == ".pdf" and "inspection" in record:
                record["inspection"]["visual_status"] = record["render"].get("visual_status", "rendered_not_reviewed")
        records.append(record)

    manifest = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_root": str(input_root),
        "output_root": str(output_root),
        "rights_policy": RIGHTS,
        "counts": {
            "total": len(records),
            "docx": sum(r["extension"] == ".docx" for r in records),
            "pdf": sum(r["extension"] == ".pdf" for r in records),
            "mp3": sum(r["extension"] == ".mp3" for r in records),
        },
        "files": records,
    }
    write_json(output_root / "manifest.json", manifest)
    (output_root / "QA_REPORT.md").write_text(make_qa_report(manifest), encoding="utf-8", newline="\n")
    print(json.dumps(manifest["counts"], ensure_ascii=False))
    failures = [r for r in records if r["extension"] == ".docx" and r.get("conversion", {}).get("status") != "converted"]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
