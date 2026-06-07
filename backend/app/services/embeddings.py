import hashlib
import math

import httpx

from app.config import Settings


class EmbeddingClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def embed_text(self, text: str) -> list[float]:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.settings.llama_embed_base_url}/embeddings",
                    json={"model": self.settings.embed_model_name, "input": text},
                )
                response.raise_for_status()
                payload = response.json()
                vector = payload["data"][0]["embedding"]
                return [float(value) for value in vector]
        except Exception:
            if not self.settings.fallback_embeddings:
                raise
            return self._fallback_embedding(text)

    def _fallback_embedding(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        vector = []
        for index in range(self.settings.embedding_dimension):
            byte = digest[index % len(digest)]
            vector.append((byte / 127.5) - 1.0)
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]
