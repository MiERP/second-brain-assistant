import json
import math
import re
from pathlib import Path
from typing import Any

from app.config import Settings


class WorkspaceVectorStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.settings.lance_db_dir.mkdir(parents=True, exist_ok=True)

    def table_name(self, workspace_id: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", workspace_id)
        return f"workspace_{safe}_chunks"

    def add_chunks(self, workspace_id: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        table_name = self.table_name(workspace_id)
        try:
            import lancedb

            db = lancedb.connect(str(self.settings.lance_db_dir))
            if table_name in db.table_names():
                table = db.open_table(table_name)
                table.add(rows)
            else:
                db.create_table(table_name, data=rows)
        except Exception:
            self._append_jsonl(table_name, rows)

    def search(self, workspace_id: str, vector: list[float], limit: int) -> list[dict[str, Any]]:
        table_name = self.table_name(workspace_id)
        try:
            import lancedb

            db = lancedb.connect(str(self.settings.lance_db_dir))
            if table_name not in db.table_names():
                return []
            table = db.open_table(table_name)
            return list(table.search(vector).limit(limit).to_list())
        except Exception:
            return self._search_jsonl(table_name, vector, limit)

    def delete_document(self, workspace_id: str, document_id: str) -> None:
        table_name = self.table_name(workspace_id)
        try:
            import lancedb

            db = lancedb.connect(str(self.settings.lance_db_dir))
            if table_name in db.table_names():
                table = db.open_table(table_name)
                safe_document_id = document_id.replace("'", "''")
                table.delete(f"document_id = '{safe_document_id}'")
        except Exception:
            self._delete_document_jsonl(table_name, document_id)

    def delete_workspace(self, workspace_id: str) -> None:
        table_name = self.table_name(workspace_id)
        try:
            import lancedb

            db = lancedb.connect(str(self.settings.lance_db_dir))
            if table_name in db.table_names():
                db.drop_table(table_name)
        except Exception:
            self._delete_workspace_jsonl(table_name)

    def _fallback_path(self, table_name: str) -> Path:
        path = self.settings.lance_db_dir / "_fallback"
        path.mkdir(parents=True, exist_ok=True)
        return path / f"{table_name}.jsonl"

    def _append_jsonl(self, table_name: str, rows: list[dict[str, Any]]) -> None:
        with self._fallback_path(table_name).open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _search_jsonl(self, table_name: str, vector: list[float], limit: int) -> list[dict[str, Any]]:
        path = self._fallback_path(table_name)
        if not path.exists():
            return []
        rows = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    row["_score"] = self._cosine(vector, row.get("vector", []))
                    rows.append(row)
        return sorted(rows, key=lambda row: row.get("_score", 0.0), reverse=True)[:limit]

    def _delete_document_jsonl(self, table_name: str, document_id: str) -> None:
        path = self._fallback_path(table_name)
        if not path.exists():
            return
        kept_rows = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("document_id") != document_id:
                    kept_rows.append(row)
        with path.open("w", encoding="utf-8") as handle:
            for row in kept_rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _delete_workspace_jsonl(self, table_name: str) -> None:
        path = self._fallback_path(table_name)
        if path.exists():
            path.unlink()

    def _cosine(self, left: list[float], right: list[float]) -> float:
        if not left or not right:
            return 0.0
        size = min(len(left), len(right))
        dot = sum(float(left[index]) * float(right[index]) for index in range(size))
        left_norm = math.sqrt(sum(float(value) * float(value) for value in left[:size]))
        right_norm = math.sqrt(sum(float(value) * float(value) for value in right[:size]))
        if not left_norm or not right_norm:
            return 0.0
        return dot / (left_norm * right_norm)
