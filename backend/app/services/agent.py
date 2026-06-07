import asyncio
from collections.abc import Iterable
import json
import math
import re
from typing import TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ChatConversation, ChatMessage, Workspace
from app.services.embeddings import EmbeddingClient
from app.services.llm_client import LlamaChatClient
from app.services.vector_store import WorkspaceVectorStore


def sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class AgentState(TypedDict, total=False):
    workspace_id: str
    message: str
    history: list[dict[str, str]]
    sub_queries: list[str]
    retrieved: list[dict]
    ranked: list[dict]
    citations: list[dict]
    needs_clarification: bool
    prompt: str


class ResearchAgent:
    DISCREPANCY_LABEL_KEYWORDS = {
        "revenue",
        "profit",
        "margin",
        "cost",
        "price",
        "capex",
        "opex",
        "valuation",
        "range",
        "capacity",
        "density",
        "energy",
        "market share",
        "doanh thu",
        "loi nhuan",
        "chi phi",
        "gia",
        "bien loi nhuan",
        "mat do",
        "dung luong",
    }
    IGNORED_DISCREPANCY_LABELS = {
        "page",
        "trang",
        "version",
        "section",
        "chapter",
        "figure",
        "table",
        "year",
        "date",
    }

    def __init__(
        self,
        settings: Settings,
        embeddings: EmbeddingClient,
        vector_store: WorkspaceVectorStore,
        llm: LlamaChatClient,
    ):
        self.settings = settings
        self.embeddings = embeddings
        self.vector_store = vector_store
        self.llm = llm
        self.graph = self._build_graph()

    async def stream_chat(
        self,
        db: Session,
        workspace_id: str,
        message: str,
        conversation_id: str | None,
        owner_id: str,
    ):
        workspace = db.get(Workspace, workspace_id)
        if not workspace or workspace.owner_id != owner_id:
            yield sse("error", {"message": "Workspace not found"})
            return

        conversation = self._get_or_create_conversation(db, workspace_id, message, conversation_id)
        history = self._conversation_history(db, conversation.id)
        db.add(ChatMessage(conversation_id=conversation.id, role="user", content=message))
        db.commit()

        graph_input = {"workspace_id": workspace_id, "message": message, "history": history}
        state: AgentState = dict(graph_input)
        yield sse("status", {"node": "planner", "message": "Đang phân tích và lập kế hoạch nghiên cứu..."})
        async for update in self.graph.astream(graph_input, stream_mode="updates"):
            for node, node_state in update.items():
                state.update(node_state)
                if node == "planner":
                    yield sse(
                        "status",
                        {"node": "retriever", "message": "Đang truy xuất ngữ cảnh trong workspace..."},
                    )
                elif node == "retriever":
                    yield sse(
                        "status",
                        {"node": "synthesizer", "message": "Đang tổng hợp và kiểm tra mâu thuẫn..."},
                    )
        citations = state.get("citations", [])
        yield sse("citations", citations)

        if state.get("needs_clarification"):
            yield sse(
                "ask_user",
                {
                    "message": "Mot so nguon co so lieu mau thuan. Vui long chon nguon uu tien hoac bo sung tieu chi.",
                    "citations": citations,
                },
            )
            return

        yield sse("status", {"node": "writer", "message": "Đang soạn báo cáo Markdown có trích dẫn..."})
        answer_parts = []
        async for delta in self.llm.stream_completion(state.get("prompt", message)):
            answer_parts.append(delta)
            yield sse("text", {"delta": delta})

        answer = self._self_correct_answer("".join(answer_parts), citations)
        db.add(
            ChatMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=answer,
                citations=citations,
            )
        )
        db.commit()
        yield sse("status", {"node": "self_correction", "message": "Đã kiểm tra cú pháp và trích dẫn."})
        yield sse("done", {"message": "Đã hoàn thành soạn thảo báo cáo."})

    def _build_graph(self):
        graph = StateGraph(AgentState)
        graph.add_node("planner", self._planner_node)
        graph.add_node("retriever", self._retriever_node)
        graph.add_node("discrepancy_checker", self._discrepancy_checker_node)
        graph.add_node("context_builder", self._context_builder_node)
        graph.set_entry_point("planner")
        graph.add_edge("planner", "retriever")
        graph.add_edge("retriever", "discrepancy_checker")
        graph.add_conditional_edges(
            "discrepancy_checker",
            self._route_after_discrepancy_check,
            {"ask_user": END, "context_builder": "context_builder"},
        )
        graph.add_edge("context_builder", END)
        return graph.compile()

    async def _planner_node(self, state: AgentState) -> AgentState:
        sub_queries = await self.llm.plan_sub_queries(
            state["message"], state.get("history", [])
        )
        return {"sub_queries": self._normalize_sub_queries(state["message"], sub_queries)}

    async def _retriever_node(self, state: AgentState) -> AgentState:
        tasks = [
            self._retrieve_query(state["workspace_id"], query)
            for query in state.get("sub_queries", [state["message"]])
        ]
        query_results = await asyncio.gather(*tasks)
        retrieved = [row for rows in query_results for row in rows]
        ranked = self._rerank(retrieved)[: self.settings.retrieval_context_limit]
        return {"retrieved": retrieved, "ranked": ranked, "citations": self._citations(ranked)}

    async def _retrieve_query(self, workspace_id: str, query: str) -> list[dict]:
        vector = await self.embeddings.embed_text(query)
        rows = self.vector_store.search(workspace_id, vector, self.settings.retrieval_raw_limit)
        scored = []
        for row in rows:
            row_copy = dict(row)
            row_copy["_score"] = self._cosine(vector, self._coerce_vector(row_copy.get("vector")))
            scored.append(row_copy)
        return scored

    async def _discrepancy_checker_node(self, state: AgentState) -> AgentState:
        return {"needs_clarification": self._needs_user_clarification(state.get("ranked", []))}

    async def _context_builder_node(self, state: AgentState) -> AgentState:
        return {
            "prompt": await self._build_prompt(
                state["message"],
                state.get("history", []),
                state.get("ranked", []),
                state.get("citations", []),
            )
        }

    def _route_after_discrepancy_check(self, state: AgentState) -> str:
        return "ask_user" if state.get("needs_clarification") else "context_builder"

    def _get_or_create_conversation(
        self,
        db: Session,
        workspace_id: str,
        message: str,
        conversation_id: str | None,
    ) -> ChatConversation:
        if conversation_id:
            conversation = db.get(ChatConversation, conversation_id)
            if conversation and conversation.workspace_id == workspace_id:
                return conversation
        conversation = ChatConversation(
            workspace_id=workspace_id,
            title=message[:80] or "Untitled",
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation

    def _conversation_history(self, db: Session, conversation_id: str) -> list[dict[str, str]]:
        messages = list(
            db.scalars(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation_id)
                .order_by(ChatMessage.created_at.desc())
                .limit(30)
            )
        )
        messages.reverse()
        return [{"role": message.role, "content": message.content} for message in messages]

    def _normalize_sub_queries(self, message: str, sub_queries: list[str]) -> list[str]:
        cleaned = []
        for query in sub_queries:
            value = " ".join(query.split())
            if value and value not in cleaned:
                cleaned.append(value)
        return cleaned[:5] or [message]

    def _rerank(self, rows: list[dict]) -> list[dict]:
        return sorted(rows, key=lambda row: float(row.get("_score", 0.0)), reverse=True)

    def _citations(self, rows: list[dict]) -> list[dict]:
        citations = []
        seen = set()
        for row in rows:
            key = (row.get("document_id"), row.get("page_label"))
            if key in seen:
                continue
            seen.add(key)
            citations.append(
                {
                    "id": len(citations) + 1,
                    "document_id": row.get("document_id"),
                    "filename": row.get("filename", "unknown"),
                    "page": row.get("page_label", 1),
                    "snippet": row.get("text", "")[:240],
                }
            )
        return citations

    def _needs_user_clarification(self, rows: list[dict]) -> bool:
        numbers_by_key: dict[str, set[str]] = {}
        for row in rows:
            text = row.get("text", "")
            for label, number in re.findall(
                r"([A-Za-z][A-Za-z0-9 _-]{2,40})\s*[:=]\s*(\d+(?:\.\d+)?)",
                text,
            ):
                normalized_label = label.strip().lower()
                if self._is_ignored_discrepancy_label(normalized_label):
                    continue
                if not self._is_meaningful_metric_label(normalized_label):
                    continue
                numbers_by_key.setdefault(normalized_label, set()).add(number)
        return any(len(values) > 1 for values in numbers_by_key.values())

    def _is_ignored_discrepancy_label(self, label: str) -> bool:
        return any(ignored == label or ignored in label for ignored in self.IGNORED_DISCREPANCY_LABELS)

    def _is_meaningful_metric_label(self, label: str) -> bool:
        return any(
            re.search(rf"(?<![A-Za-z0-9]){re.escape(keyword)}(?![A-Za-z0-9])", label)
            for keyword in self.DISCREPANCY_LABEL_KEYWORDS
        )

    async def _build_prompt(
        self,
        message: str,
        history: list[dict[str, str]],
        rows: list[dict],
        citations: list[dict],
    ) -> str:
        context_lines = []
        citation_by_doc_page = {
            (citation["document_id"], citation["page"]): citation["id"] for citation in citations
        }
        for row in rows:
            citation_id = citation_by_doc_page.get((row.get("document_id"), row.get("page_label")), 0)
            context_lines.append(
                f"[{citation_id}] ({row.get('filename', 'unknown')}, trang {row.get('page_label', 1)})\n{row.get('text', '')}"
            )
        context = "\n\n".join(context_lines) or "Khong tim thay chunk lien quan trong workspace."
        history_text = await self._build_history_text(history)
        return (
            "You are a local-first research assistant. Write in Markdown, use only the supplied context, "
            "keep claims verifiable, and cite sources as [n] (filename, page_number).\n\n"
            f"Recent conversation history:\n{history_text}\n\n"
            f"Current question: {message}\n\n"
            f"Document context:\n{context}\n"
        )

    async def _build_history_text(self, history: list[dict[str, str]]) -> str:
        if not history:
            return "No previous conversation history."

        budget_tokens = max(50, self.settings.summarize_history_after_tokens)
        lines = [self._format_history_item(item) for item in history]
        if self._estimate_tokens("\n".join(lines)) <= budget_tokens:
            return "\n".join(lines)

        recent_lines: list[str] = []
        recent_tokens = 0
        recent_budget = max(20, budget_tokens // 3)
        for item in reversed(history):
            line = self._format_history_item(item)
            line_tokens = self._estimate_tokens(line)
            if recent_lines and recent_tokens + line_tokens > recent_budget:
                break
            recent_lines.append(line)
            recent_tokens += line_tokens
            if recent_tokens >= recent_budget:
                break

        recent_lines.reverse()
        older_history = history[: max(0, len(history) - len(recent_lines))]
        if not older_history:
            return "\n".join(recent_lines)

        summary = await self._summarize_history(
            older_history, max(30, budget_tokens - recent_tokens - 20)
        )
        sections = [f"Summary of earlier conversation:\n{summary}"]
        if recent_lines:
            sections.append("Recent messages:\n" + "\n".join(recent_lines))
        return "\n\n".join(sections)

    def _format_history_item(self, item: dict[str, str]) -> str:
        role = item.get("role", "user")
        content = " ".join(item.get("content", "").split())
        return f"{role}: {content}"

    async def _summarize_history(
        self, history: list[dict[str, str]], target_tokens: int
    ) -> str:
        summarizer = getattr(self.llm, "summarize_history", None)
        if summarizer:
            try:
                return await summarizer(history, target_tokens)
            except Exception:
                pass
        return self._fallback_history_summary(history, target_tokens)

    def _fallback_history_summary(
        self, history: list[dict[str, str]], target_tokens: int
    ) -> str:
        budget_chars = max(120, target_tokens * 4)
        text = " ".join(self._format_history_item(item) for item in history)
        text = " ".join(text.split())
        if len(text) <= budget_chars:
            return text
        return f"...{text[-(budget_chars - 3):]}"

    def _estimate_tokens(self, text: str) -> int:
        return max(1, math.ceil(len(text) / 4))

    def _self_correct_answer(self, answer: str, citations: list[dict]) -> str:
        if citations and not re.search(r"\[\d+\]", answer):
            return f"{answer}\n\nNguon: " + ", ".join(
                f"[{citation['id']}] ({citation['filename']}, trang {citation['page']})"
                for citation in citations
            )
        return answer

    def _cosine(self, left, right) -> float:
        left = self._coerce_vector(left)
        right = self._coerce_vector(right)
        if not left or not right:
            return 0.0
        size = min(len(left), len(right))
        dot = sum(float(left[index]) * float(right[index]) for index in range(size))
        left_norm = math.sqrt(sum(float(value) * float(value) for value in left[:size]))
        right_norm = math.sqrt(sum(float(value) * float(value) for value in right[:size]))
        if not left_norm or not right_norm:
            return 0.0
        return dot / (left_norm * right_norm)

    def _coerce_vector(self, vector) -> list[float]:
        if vector is None or isinstance(vector, (str, bytes)):
            return []
        if hasattr(vector, "to_pylist"):
            vector = vector.to_pylist()
        elif hasattr(vector, "tolist"):
            vector = vector.tolist()
        elif not isinstance(vector, list) and isinstance(vector, Iterable):
            vector = list(vector)
        if not isinstance(vector, list):
            return []
        return [float(value) for value in vector]
