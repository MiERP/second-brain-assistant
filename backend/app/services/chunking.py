from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedSection:
    text: str
    page_label: int = 1
    chunk_type: str = "text"


@dataclass(frozen=True)
class Chunk:
    text: str
    page_label: int
    chunk_type: str


def split_markdown_into_chunks(
    sections: list[ParsedSection],
    max_words: int,
    overlap_words: int,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for section in sections:
        blocks = _extract_table_blocks(section.text)
        for block_text, is_table in blocks:
            if is_table:
                chunks.append(
                    Chunk(
                        text=block_text.strip(),
                        page_label=section.page_label,
                        chunk_type="table",
                    )
                )
                continue

            for text in _split_words(block_text, max_words, overlap_words):
                chunks.append(
                    Chunk(
                        text=text,
                        page_label=section.page_label,
                        chunk_type=section.chunk_type,
                    )
                )
    return [chunk for chunk in chunks if chunk.text.strip()]


def _extract_table_blocks(markdown: str) -> list[tuple[str, bool]]:
    lines = markdown.splitlines()
    blocks: list[tuple[str, bool]] = []
    buffer: list[str] = []
    table: list[str] = []

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer:
            blocks.append(("\n".join(buffer), False))
            buffer = []

    def flush_table() -> None:
        nonlocal table
        if table:
            blocks.append(("\n".join(table), True))
            table = []

    for line in lines:
        stripped = line.strip()
        is_table_line = stripped.startswith("|") and stripped.endswith("|")
        if is_table_line:
            flush_buffer()
            table.append(line)
        else:
            flush_table()
            buffer.append(line)

    flush_table()
    flush_buffer()
    return blocks


def _split_words(text: str, max_words: int, overlap_words: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    if len(words) <= max_words:
        return [" ".join(words)]

    step = max(1, max_words - overlap_words)
    parts: list[str] = []
    start = 0
    while start < len(words):
        part = words[start : start + max_words]
        parts.append(" ".join(part))
        if start + max_words >= len(words):
            break
        start += step
    return parts
