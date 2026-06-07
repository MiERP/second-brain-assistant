from fastapi import APIRouter

from app.config import Settings, get_settings
from app.schemas import HealthRead
from app.services.llama_process import LlamaProcessManager

router = APIRouter(tags=["health"])


@router.get("/", response_model=HealthRead)
def read_root(settings: Settings = get_settings()):
    return HealthRead(
        status="online",
        api="Second Brain Assistant API",
        llama_chat_url=settings.llama_chat_base_url,
        llama_embed_url=settings.llama_embed_base_url,
    )


@router.get("/health", response_model=HealthRead)
def health(settings: Settings = get_settings()):
    return read_root(settings)


@router.get("/health/models")
async def model_health(settings: Settings = get_settings()):
    manager = LlamaProcessManager(settings)
    machine = manager.detect_machine_info()
    runtime = manager.compute_runtime_profile()
    return {
        "auto_start_llama": settings.auto_start_llama,
        "llama_auto_root": str(manager.find_auto_root() or ""),
        "llama_server_bin": str(manager.find_llama_server_bin() or ""),
        "machine": {
            "cpu_cores": machine.cpu_cores,
            "cpu_threads": machine.cpu_threads,
            "ram_mb": machine.ram_mb,
            "gpu_name": machine.gpu_name,
            "gpu_vendor": machine.gpu_vendor,
            "gpu_type": machine.gpu_type,
            "gpu_vram_mb": machine.gpu_vram_mb,
            "has_dgpu": machine.has_dgpu,
        },
        "runtime": {
            "backend": runtime.backend,
            "chat_ctx_size": runtime.chat_ctx_size,
            "embedding_ctx_size": runtime.embedding_ctx_size,
            "threads": runtime.threads,
            "batch_size": runtime.batch_size,
            "ubatch_size": runtime.ubatch_size,
            "n_gpu_layers": runtime.n_gpu_layers,
        },
        "chat_model_name": settings.chat_model_name,
        "chat_model_path": str(manager.find_model("chat") or ""),
        "chat_context_tokens": settings.chat_context_tokens,
        "chat_url": settings.llama_chat_base_url,
        "chat_up": await manager.is_server_up("chat"),
        "embed_model_name": settings.embed_model_name,
        "embed_model_path": str(manager.find_model("embedding") or ""),
        "embed_url": settings.llama_embed_base_url,
        "embed_up": await manager.is_server_up("embedding"),
    }
