import json
import re

import httpx

from app.config import Settings


class LlamaChatClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def stream_completion(self, prompt: str):
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{self.settings.llama_chat_base_url}/chat/completions",
                    json={
                        "model": self.settings.chat_model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": True,
                    },
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line.removeprefix("data:").strip()
                        if data == "[DONE]":
                            break
                        payload = json.loads(data)
                        delta = payload["choices"][0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
            return
        except Exception:
            for part in self._fallback_response(prompt):
                yield part

    async def plan_sub_queries(
        self, message: str, history: list[dict[str, str]] | None = None
    ) -> list[str]:
        history_text = self._format_history(history or [])
        prompt = (
            "You are the planner node for a local research RAG system. "
            "Break the user request into 2-5 concise semantic search sub-queries. "
            "Use recent conversation history to resolve pronouns and follow-up references. "
            "Return only JSON with this schema: {\"queries\": [\"...\"]}.\n\n"
            f"Recent conversation history:\n{history_text}\n\n"
            f"User request: {message}"
        )
        try:
            response_text = await self.complete_text(prompt, temperature=0.1)
            payload = self._extract_json_object(response_text)
            queries = payload.get("queries", [])
            if isinstance(queries, list):
                return [str(query) for query in queries if str(query).strip()]
        except Exception:
            pass
        return self._fallback_sub_queries(message)

    def _format_history(self, history: list[dict[str, str]]) -> str:
        if not history:
            return "No previous conversation."
        lines = []
        for item in history[-10:]:
            role = item.get("role", "user")
            content = " ".join(item.get("content", "").split())
            lines.append(f"{role}: {content[:500]}")
        return "\n".join(lines)

    async def complete_text(self, prompt: str, temperature: float = 0.2) -> str:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{self.settings.llama_chat_base_url}/chat/completions",
                json={
                    "model": self.settings.chat_model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            payload = response.json()
            return str(payload["choices"][0]["message"]["content"])

    async def summarize_history(
        self, history: list[dict[str, str]], target_tokens: int = 800
    ) -> str:
        history_text = self._format_history(history)
        prompt = (
            "Summarize the earlier conversation for a research assistant. "
            "Preserve user goals, entities, comparisons, decisions, unresolved questions, "
            "and source/citation references when present. "
            f"Keep the summary under about {target_tokens} tokens. "
            "Return plain text only.\n\n"
            f"Conversation:\n{history_text}"
        )
        try:
            return await self.complete_text(prompt, temperature=0.1)
        except Exception:
            return self._fallback_history_summary(history, target_tokens)

    def _fallback_response(self, prompt: str) -> list[str]:
        return [
            "Backend local đã nhận yêu cầu và chưa kết nối được llama.cpp chat server. ",
            "Khi cấu hình GGUF trong `llama_auto_root/models`, câu trả lời sẽ được sinh bởi model local. ",
            "Dưới đây là phần ngữ cảnh đã truy xuất để frontend có thể kiểm thử luồng SSE.\n\n",
            prompt[:1200],
        ]

    def _fallback_history_summary(
        self, history: list[dict[str, str]], target_tokens: int
    ) -> str:
        budget_chars = max(120, target_tokens * 4)
        text = " ".join(self._format_history(history).split())
        if len(text) <= budget_chars:
            return text
        return f"{text[: budget_chars - 3]}..."

    def _extract_json_object(self, text: str) -> dict:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                raise
            return json.loads(match.group(0))

    def _fallback_sub_queries(self, message: str) -> list[str]:
        normalized = " ".join(message.split())
        if not normalized:
            return []
        segments = [
            segment.strip(" ?.!")
            for segment in re.split(r"\band\b|,|;|\n", normalized, flags=re.IGNORECASE)
            if segment.strip(" ?.!") and len(segment.strip(" ?.!")) > 3
        ]
        return segments[:5] or [normalized]
