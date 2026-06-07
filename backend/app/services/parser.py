from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.services.chunking import ParsedSection


@dataclass(frozen=True)
class ParsedDocument:
    markdown: str
    page_count: int
    sections: list[ParsedSection]


def parse_document_file(path: str) -> ParsedDocument:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix in {".txt", ".md"}:
        markdown = file_path.read_text(encoding="utf-8", errors="replace")
        return ParsedDocument(
            markdown=markdown,
            page_count=1,
            sections=[ParsedSection(text=markdown, page_label=1, chunk_type="text")],
        )
    if suffix == ".pdf":
        try:
            return _parse_with_docling(file_path)
        except ModuleNotFoundError as exc:
            if exc.name not in {None, "docling"} and "docling" not in str(exc):
                raise
            return _parse_pdf_with_pypdf(file_path)

    try:
        return _parse_with_docling(file_path)
    except Exception as exc:
        raise RuntimeError(f"Unable to parse {file_path.name}: {exc}") from exc


def warm_docling_converter() -> bool:
    get_docling_converter()
    return True


@lru_cache(maxsize=1)
def get_docling_converter():
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def _parse_with_docling(file_path: Path) -> ParsedDocument:
    converter = get_docling_converter()
    result = converter.convert(file_path)
    document = result.document
    markdown = document.export_to_markdown()
    page_count = len(getattr(document, "pages", {}) or {}) or 1
    sections = _sections_from_docling_document(document)
    if not sections:
        sections = [ParsedSection(text=markdown, page_label=1, chunk_type="text")]
    return ParsedDocument(markdown=markdown, page_count=page_count, sections=sections)


def _parse_pdf_with_pypdf(file_path: Path) -> ParsedDocument:
    from pypdf import PdfReader

    reader = PdfReader(str(file_path))
    sections: list[ParsedSection] = []
    markdown_parts: list[str] = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = text.strip()
        if not text:
            continue
        markdown_parts.append(f"## Page {index}\n\n{text}")
        sections.append(ParsedSection(text=text, page_label=index, chunk_type="text"))

    if not sections:
        raise RuntimeError("PDF contains no extractable text. Install Docling/OCR support for scanned PDFs.")

    return ParsedDocument(
        markdown="\n\n".join(markdown_parts),
        page_count=max(1, len(reader.pages)),
        sections=sections,
    )


def _sections_from_docling_document(document: Any) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    iterate_items = getattr(document, "iterate_items", None)
    if not callable(iterate_items):
        return sections

    for entry in iterate_items():
        item = entry[0] if isinstance(entry, tuple) else entry
        text = _item_markdown(item)
        if not text:
            continue
        sections.append(
            ParsedSection(
                text=text,
                page_label=_item_page_label(item),
                chunk_type=_item_chunk_type(item),
            )
        )
    return sections


def _item_markdown(item: Any) -> str:
    for method_name in ("export_to_markdown", "to_markdown"):
        method = getattr(item, method_name, None)
        if callable(method):
            try:
                text = method()
                if text:
                    return str(text)
            except TypeError:
                continue
    text = getattr(item, "text", None)
    if text:
        return str(text)
    return ""


def _item_page_label(item: Any) -> int:
    provenance = getattr(item, "prov", None) or []
    if provenance:
        page_no = getattr(provenance[0], "page_no", None)
        if isinstance(page_no, int) and page_no > 0:
            return page_no
    return 1


def _item_chunk_type(item: Any) -> str:
    class_name = item.__class__.__name__.lower()
    if "table" in class_name:
        return "table"
    if "picture" in class_name or "image" in class_name:
        return "image"
    return "text"
